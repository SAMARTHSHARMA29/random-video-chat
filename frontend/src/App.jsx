import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// --------------------------------
// WEBRTC ICE SERVERS
// --------------------------------

const iceServers = [
  {
    urls: "stun:stun.l.google.com:19302",
  },
];

// Add TURN server when credentials are available
if (
  import.meta.env.VITE_TURN_URL &&
  import.meta.env.VITE_TURN_USERNAME &&
  import.meta.env.VITE_TURN_CREDENTIAL
) {
  iceServers.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
const socket = io(BACKEND_URL);

function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  const strangerIdRef = useRef(null);

  const typingTimeoutRef = useRef(null);
  const iceCandidatesQueueRef = useRef([]);

  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("Ready");

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const [waitingCount, setWaitingCount] = useState(0);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const [strangerTyping, setStrangerTyping] = useState(false);

  const [showReport, setShowReport] = useState(false);

  // --------------------------------
  // CREATE WEBRTC CONNECTION
  // --------------------------------

  const createPeerConnection = (strangerId) => {
    // Close old connection if one exists
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;

      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear old ICE candidates
    iceCandidatesQueueRef.current = [];

    const peerConnection = new RTCPeerConnection({
      iceServers,
    });

    peerConnectionRef.current = peerConnection;

    // --------------------------------
    // ADD LOCAL AUDIO + VIDEO
    // --------------------------------

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(
          track,
          localStreamRef.current
        );
      });
    }

    // --------------------------------
    // RECEIVE STRANGER VIDEO
    // --------------------------------

    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // --------------------------------
    // SEND ICE CANDIDATES
    // --------------------------------

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: strangerId,
          candidate: event.candidate,
        });
      }
    };

    // --------------------------------
    // CONNECTION STATE
    // --------------------------------

    peerConnection.onconnectionstatechange = () => {
      const connectionState =
        peerConnection.connectionState;

      console.log(
        "Connection state:",
        connectionState
      );

      if (connectionState === "connecting") {
        setStatus("Connecting...");
      }

      if (connectionState === "connected") {
        setStatus("Connected");
      }

      if (connectionState === "disconnected") {
        setStatus("Connection interrupted");
      }

      if (connectionState === "failed") {
        setStatus("Connection failed");

        setTimeout(() => {
          if (started) {
            stopConnection();

            socket.emit("find-stranger");

            setStatus("Finding a new stranger...");
          }
        }, 1500);
      }

      if (connectionState === "closed") {
        setStatus("Disconnected");
      }
    };

    // --------------------------------
    // ICE CONNECTION STATE
    // --------------------------------

    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "ICE connection state:",
        peerConnection.iceConnectionState
      );
    };

    return peerConnection;
  };

  // --------------------------------
  // ADD QUEUED ICE CANDIDATES
  // --------------------------------

  const addQueuedIceCandidates = async (
    peerConnection
  ) => {
    if (!peerConnection.remoteDescription) {
      return;
    }

    for (const candidate of iceCandidatesQueueRef.current) {
      try {
        await peerConnection.addIceCandidate(
          candidate
        );
      } catch (error) {
        console.error(
          "Failed to add queued ICE candidate:",
          error
        );
      }
    }

    iceCandidatesQueueRef.current = [];
  };

  // --------------------------------
  // START CAMERA
  // --------------------------------

  const startCamera = async () => {
    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return true;
    } catch (error) {
      console.error(
        "Camera/microphone error:",
        error
      );

      alert(
        "Please allow camera and microphone permission to use video chat."
      );

      return false;
    }
  };

  // --------------------------------
  // START CHAT
  // --------------------------------

  const startChat = async () => {
    const cameraStarted = await startCamera();

    if (!cameraStarted) {
      return;
    }

    setStarted(true);
    setStatus("Finding a stranger...");

    socket.emit("find-stranger");
  };

  // --------------------------------
  // STOP CONNECTION
  // --------------------------------

  const stopConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange =
        null;
      peerConnectionRef.current.oniceconnectionstatechange =
        null;

      peerConnectionRef.current.close();

      peerConnectionRef.current = null;
    }

    iceCandidatesQueueRef.current = [];

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    strangerIdRef.current = null;
  };

  // --------------------------------
  // NEXT STRANGER
  // --------------------------------

  const nextStranger = () => {
    stopConnection();

    setMessages([]);
    setStrangerTyping(false);

    setStatus("Finding a new stranger...");

    socket.emit("next");
  };

  // --------------------------------
  // STOP CHAT
  // --------------------------------

  const stopChat = () => {
    stopConnection();

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setStarted(false);
    setMuted(false);
    setCameraOff(false);

    setMessages([]);
    setStrangerTyping(false);

    setStatus("Ready");

    socket.emit("stop");
  };

  // --------------------------------
  // MUTE / UNMUTE
  // --------------------------------

  const toggleMute = () => {
    if (!localStreamRef.current) {
      return;
    }

    const audioTracks =
      localStreamRef.current.getAudioTracks();

    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    setMuted((previous) => !previous);
  };

  // --------------------------------
  // CAMERA ON / OFF
  // --------------------------------

  const toggleCamera = () => {
    if (!localStreamRef.current) {
      return;
    }

    const videoTracks =
      localStreamRef.current.getVideoTracks();

    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    setCameraOff((previous) => !previous);
  };

  // --------------------------------
  // SEND MESSAGE
  // --------------------------------

  const sendMessage = () => {
    const trimmedMessage = message.trim();

    if (
      !trimmedMessage ||
      !strangerIdRef.current
    ) {
      return;
    }

    socket.emit("send-message", {
      to: strangerIdRef.current,
      message: trimmedMessage,
    });

    setMessages((previous) => [
      ...previous,
      {
        text: trimmedMessage,
        sender: "me",
      },
    ]);

    setMessage("");
  };

  // --------------------------------
  // TYPING
  // --------------------------------

  const handleTyping = (event) => {
    const value = event.target.value;

    setMessage(value);

    if (!strangerIdRef.current) {
      return;
    }

    socket.emit("typing", {
      to: strangerIdRef.current,
    });

    clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stop-typing", {
        to: strangerIdRef.current,
      });
    }, 1000);
  };

  // --------------------------------
  // REPORT USER
  // --------------------------------

  const reportUser = () => {
    if (!strangerIdRef.current) {
      return;
    }

    socket.emit("report-user", {
      strangerId: strangerIdRef.current,
      reason: "Inappropriate behavior",
    });
  };

  // --------------------------------
  // BLOCK USER
  // --------------------------------

  const blockUser = () => {
    if (!strangerIdRef.current) {
      return;
    }

    socket.emit("block-user", {
      strangerId: strangerIdRef.current,
    });
  };

  // --------------------------------
  // SOCKET EVENTS
  // --------------------------------

  useEffect(() => {
    // Waiting
    socket.on("waiting", () => {
      setStatus("Waiting for a stranger...");
    });

    // Waiting count
    socket.on("waiting-count", (count) => {
      setWaitingCount(count);
    });

    // --------------------------------
    // MATCHED
    // --------------------------------

    socket.on(
      "matched",
      async ({ strangerId, initiator }) => {
        console.log(
          "Matched with:",
          strangerId
        );

        console.log(
          "Initiator:",
          initiator
        );

        strangerIdRef.current = strangerId;

        setStatus("Connecting...");
        setMessages([]);
        setStrangerTyping(false);

        const peerConnection =
          createPeerConnection(strangerId);

        // If initiator, create offer
        if (initiator) {
          try {
            const offer =
              await peerConnection.createOffer();

            await peerConnection.setLocalDescription(
              offer
            );

            socket.emit("offer", {
              to: strangerId,
              offer,
            });
          } catch (error) {
            console.error(
              "Offer error:",
              error
            );
          }
        }
      }
    );

    // --------------------------------
    // OFFER
    // --------------------------------

    socket.on(
      "offer",
      async ({ from, offer }) => {
        console.log(
          "Received offer from:",
          from
        );

        strangerIdRef.current = from;

        const peerConnection =
          createPeerConnection(from);

        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(offer)
          );

          await addQueuedIceCandidates(
            peerConnection
          );

          const answer =
            await peerConnection.createAnswer();

          await peerConnection.setLocalDescription(
            answer
          );

          socket.emit("answer", {
            to: from,
            answer,
          });
        } catch (error) {
          console.error(
            "Offer handling error:",
            error
          );
        }
      }
    );

    // --------------------------------
    // ANSWER
    // --------------------------------

    socket.on(
      "answer",
      async ({ answer }) => {
        console.log(
          "Received answer"
        );

        const peerConnection =
          peerConnectionRef.current;

        if (!peerConnection) {
          return;
        }

        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(answer)
          );

          await addQueuedIceCandidates(
            peerConnection
          );

          setStatus("Connected");
        } catch (error) {
          console.error(
            "Answer handling error:",
            error
          );
        }
      }
    );

    // --------------------------------
    // ICE CANDIDATE
    // --------------------------------

    socket.on(
      "ice-candidate",
      async ({ candidate }) => {
        const peerConnection =
          peerConnectionRef.current;

        if (!candidate) {
          return;
        }

        // Peer connection not ready
        if (!peerConnection) {
          iceCandidatesQueueRef.current.push(
            candidate
          );

          return;
        }

        // Remote description not ready
        if (!peerConnection.remoteDescription) {
          iceCandidatesQueueRef.current.push(
            candidate
          );

          return;
        }

        try {
          await peerConnection.addIceCandidate(
            candidate
          );
        } catch (error) {
          console.error(
            "ICE candidate error:",
            error
          );
        }
      }
    );

    // --------------------------------
    // RECEIVE MESSAGE
    // --------------------------------

    socket.on(
      "receive-message",
      ({ message }) => {
        setMessages((previous) => [
          ...previous,
          {
            text: message,
            sender: "stranger",
          },
        ]);
      }
    );

    // --------------------------------
    // STRANGER TYPING
    // --------------------------------

    socket.on(
      "stranger-typing",
      () => {
        setStrangerTyping(true);
      }
    );

    socket.on(
      "stranger-stop-typing",
      () => {
        setStrangerTyping(false);
      }
    );

    // --------------------------------
    // STRANGER LEFT
    // --------------------------------

    socket.on(
      "stranger-left",
      () => {
        stopConnection();

        setStrangerTyping(false);
        setStatus("Stranger left");

        setTimeout(() => {
          if (started) {
            socket.emit("find-stranger");

            setStatus(
              "Finding a new stranger..."
            );
          }
        }, 1000);
      }
    );

    // --------------------------------
    // REPORT SUCCESS
    // --------------------------------

    socket.on(
      "report-success",
      () => {
        alert(
          "Report submitted successfully."
        );

        setShowReport(false);
      }
    );

    // --------------------------------
    // BLOCK SUCCESS
    // --------------------------------

    socket.on(
      "block-success",
      () => {
        alert("User blocked.");

        setShowReport(false);

        nextStranger();
      }
    );

    // --------------------------------
    // STRANGER BLOCKED US
    // --------------------------------

    socket.on(
      "stranger-blocked",
      () => {
        stopConnection();

        setStatus("Stranger left");

        setTimeout(() => {
          if (started) {
            socket.emit("find-stranger");

            setStatus(
              "Finding a new stranger..."
            );
          }
        }, 1000);
      }
    );

    // --------------------------------
    // CLEANUP SOCKET EVENTS
    // --------------------------------

    return () => {
      socket.off("waiting");
      socket.off("waiting-count");
      socket.off("matched");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("receive-message");
      socket.off("stranger-typing");
      socket.off("stranger-stop-typing");
      socket.off("stranger-left");
      socket.off("report-success");
      socket.off("block-success");
      socket.off("stranger-blocked");
    };
  }, [started]);

  // --------------------------------
  // STATUS CLASS
  // --------------------------------

  const getStatusClass = () => {
    if (status === "Connected") {
      return "connected";
    }

    if (
      status.includes("Finding") ||
      status.includes("Waiting") ||
      status.includes("Connecting")
    ) {
      return "waiting";
    }

    return "";
  };

  // --------------------------------
  // UI
  // --------------------------------

  return (
    <div className="app">

      {/* HEADER */}

      <header className="header">
        <div className="logo">
          <div className="logo-icon">
            ◉
          </div>

          <span>RandomChat</span>
        </div>

        <div className="online-status">
          <span className="online-dot"></span>
          Online
        </div>
      </header>

      {/* MAIN */}

      <main className="main">

        {/* STATUS */}

        <section className="status-section">

          <div
            className={`status-badge ${getStatusClass()}`}
          >
            <span className="status-dot"></span>

            {status}
          </div>

          {waitingCount > 0 && (
            <div className="waiting-info">
              {waitingCount} people waiting
            </div>
          )}

        </section>

        {/* VIDEO SECTION */}

        <section className="video-section">

          {/* MY VIDEO */}

          <div className="video-card">

            <div className="video-label">
              <span className="label-dot"></span>
              You
            </div>

            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video"
            />

            {!started && (
              <div className="video-placeholder">

                <div className="placeholder-icon">
                  ◉
                </div>

                <p>Camera preview</p>

              </div>
            )}

            {cameraOff && started && (
              <div className="camera-off-overlay">

                <div className="stranger-avatar">
                  You
                </div>

                <p>Camera Off</p>

              </div>
            )}

          </div>

          {/* VS */}

          <div className="vs-badge">
            VS
          </div>

          {/* STRANGER VIDEO */}

          <div className="video-card">

            <div className="video-label">

              <span className="label-dot stranger-dot"></span>

              Stranger

            </div>

            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="video"
            />

            {!started && (
              <div className="video-placeholder">

                <div className="placeholder-icon">
                  ?
                </div>

                <p>Waiting to connect</p>

              </div>
            )}

            {started &&
              !remoteVideoRef.current?.srcObject && (
                <div className="video-placeholder">

                  <div className="stranger-avatar">
                    ?
                  </div>

                  <p>{status}</p>

                </div>
              )}

          </div>

        </section>

        {/* CONTROLS */}

        <section className="controls-section">

          {!started ? (

            <button
              className="start-button"
              onClick={startChat}
            >
              Start Chat
            </button>

          ) : (

            <div className="controls">

              <button
                className="control-button"
                onClick={toggleMute}
              >
                {muted
                  ? "🔇 Unmute"
                  : "🎤 Mute"}
              </button>

              <button
                className="control-button"
                onClick={toggleCamera}
              >
                {cameraOff
                  ? "📷 Camera On"
                  : "📷 Camera Off"}
              </button>

              <button
                className="control-button next-button"
                onClick={nextStranger}
              >
                Next →
              </button>

              <button
                className="control-button stop-button"
                onClick={stopChat}
              >
                Stop
              </button>

            </div>
          )}

          {/* SAFETY */}

          {started && (
            <div className="safety-controls">

              <button
                onClick={() =>
                  setShowReport(true)
                }
              >
                ⚠ Report
              </button>

              <button
                onClick={blockUser}
              >
                🚫 Block
              </button>

            </div>
          )}

        </section>

        {/* CHAT */}

        <section className="chat-container">

          <div className="chat-header">

            <span>Chat</span>

            {strangerTyping && (
              <span className="typing-text">
                Stranger is typing...
              </span>
            )}

          </div>

          <div className="messages">

            {messages.length === 0 && (
              <div className="empty-chat">
                Start chatting with your stranger
              </div>
            )}

            {messages.map(
              (msg, index) => (
                <div
                  key={index}
                  className={`message-row ${
                    msg.sender === "me"
                      ? "my-message"
                      : "stranger-message"
                  }`}
                >
                  <div className="message-bubble">
                    {msg.text}
                  </div>
                </div>
              )
            )}

            {strangerTyping && (
              <div className="message-row stranger-message">

                <div className="typing-bubble">

                  <span></span>
                  <span></span>
                  <span></span>

                </div>

              </div>
            )}

          </div>

          {/* CHAT INPUT */}

          <div className="chat-input">

            <input
              type="text"
              value={message}
              onChange={handleTyping}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMessage();
                }
              }}
              placeholder={
                started
                  ? "Type a message..."
                  : "Start chat to send messages"
              }
              disabled={!started}
            />

            <button
              onClick={sendMessage}
              disabled={!started}
            >
              Send
            </button>

          </div>

        </section>

      </main>

      {/* FOOTER */}

      <footer>
        <p>
          Be respectful. Stay safe. Have fun.
        </p>
      </footer>

      {/* REPORT POPUP */}

      {showReport && (
        <div className="report-overlay">

          <div className="report-box">

            <div className="report-icon">
              ⚠
            </div>

            <h2>Report User</h2>

            <p>
              Are you sure you want to report this person?
            </p>

            <div className="report-actions">

              <button
                onClick={() =>
                  setShowReport(false)
                }
              >
                Cancel
              </button>

              <button
                className="stop-button"
                onClick={reportUser}
              >
                Report
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}

export default App;