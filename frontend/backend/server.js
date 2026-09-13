const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

// =====================================
// CORS CONFIGURATION
// =====================================

const corsOptions = {
  origin: [
    "https://random-video-chat-lac.vercel.app",
    "http://localhost:5173",
  ],
  methods: ["GET", "POST"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);

// =====================================
// SOCKET.IO
// =====================================

const io = new Server(server, {
  cors: corsOptions,
});

// =====================================
// WAITING USERS
// =====================================

const waitingUsers = [];

// =====================================
// CONNECTED USERS
// =====================================

const users = new Map();

// =====================================
// RECENT PARTNERS
// =====================================

const recentPartners = new Map();

// =====================================
// REPORTS
// =====================================

const reports = [];

// =====================================
// REMOVE USER FROM WAITING
// =====================================

const removeFromWaiting = (socketId) => {
  const index = waitingUsers.indexOf(socketId);

  if (index !== -1) {
    waitingUsers.splice(index, 1);
  }
};

// =====================================
// SEND WAITING COUNT
// =====================================

const sendWaitingCount = () => {
  io.emit("waiting-count", {
    count: waitingUsers.length,
  });
};

// =====================================
// CHECK RECENT PARTNER
// =====================================

const wasRecentlyConnected = (userId, strangerId) => {
  const recent = recentPartners.get(userId);

  if (!recent) {
    return false;
  }

  const TWO_MINUTES = 2 * 60 * 1000;

  const timePassed = Date.now() - recent.time;

  if (timePassed > TWO_MINUTES) {
    recentPartners.delete(userId);

    return false;
  }

  return recent.partnerId === strangerId;
};

// =====================================
// SAVE RECENT PARTNER
// =====================================

const saveRecentPartner = (userId, strangerId) => {
  recentPartners.set(userId, {
    partnerId: strangerId,
    time: Date.now(),
  });
};

// =====================================
// FIND STRANGER
// =====================================

const findStranger = (socket) => {
  const currentUser = users.get(socket.id);

  if (!currentUser) {
    return;
  }

  // Don't add same user twice
  if (waitingUsers.includes(socket.id)) {
    socket.emit("waiting");

    sendWaitingCount();

    return;
  }

  // Remove disconnected users
  for (let i = waitingUsers.length - 1; i >= 0; i--) {
    const waitingId = waitingUsers[i];

    if (!users.has(waitingId)) {
      waitingUsers.splice(i, 1);
    }
  }

  // =====================================
  // FIND COMPATIBLE STRANGER
  // =====================================

  let strangerId = null;

  for (let i = 0; i < waitingUsers.length; i++) {
    const candidateId = waitingUsers[i];

    const candidate = users.get(candidateId);

    if (!candidate) {
      continue;
    }

    // Don't match yourself
    if (candidateId === socket.id) {
      continue;
    }

    // Current user blocked candidate
    if (currentUser.blockedUsers.includes(candidateId)) {
      continue;
    }

    // Candidate blocked current user
    if (candidate.blockedUsers.includes(socket.id)) {
      continue;
    }

    // Don't immediately rematch
    if (wasRecentlyConnected(socket.id, candidateId)) {
      continue;
    }

    if (wasRecentlyConnected(candidateId, socket.id)) {
      continue;
    }

    strangerId = candidateId;

    waitingUsers.splice(i, 1);

    break;
  }

  // =====================================
  // NO STRANGER FOUND
  // =====================================

  if (!strangerId) {
    waitingUsers.push(socket.id);

    socket.emit("waiting");

    sendWaitingCount();

    console.log("User waiting:", socket.id);

    console.log("Waiting users:", waitingUsers);

    return;
  }

  // =====================================
  // GET STRANGER
  // =====================================

  const stranger = users.get(strangerId);

  if (!stranger) {
    findStranger(socket);

    return;
  }

  // =====================================
  // SAVE CONNECTION
  // =====================================

  currentUser.strangerId = strangerId;

  stranger.strangerId = socket.id;

  console.log("Matched:", socket.id, "<->", strangerId);

  // =====================================
  // MATCHED EVENT
  // =====================================

  socket.emit("matched", {
    strangerId,
    initiator: true,
  });

  io.to(strangerId).emit("matched", {
    strangerId: socket.id,
    initiator: false,
  });

  // Update waiting count
  sendWaitingCount();
};

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  users.set(socket.id, {
    strangerId: null,
    blockedUsers: [],
  });

  // Send current waiting count
  socket.emit("waiting-count", {
    count: waitingUsers.length,
  });

  // =====================================
  // FIND STRANGER
  // =====================================

  socket.on("find-stranger", () => {
    console.log("Finding stranger:", socket.id);

    findStranger(socket);
  });

  // =====================================
  // WEBRTC OFFER
  // NOTE: Frontend sends { to, offer } — we read "to" as the target
  // =====================================

  socket.on("offer", ({ to, offer }) => {
    if (!to) return;

    io.to(to).emit("offer", {
      from: socket.id,
      offer,
    });
  });

  // =====================================
  // WEBRTC ANSWER
  // NOTE: Frontend sends { to, answer }
  // =====================================

  socket.on("answer", ({ to, answer }) => {
    if (!to) return;

    io.to(to).emit("answer", {
      from: socket.id,
      answer,
    });
  });

  // =====================================
  // ICE CANDIDATE
  // NOTE: Frontend sends { to, candidate }
  // =====================================

  socket.on("ice-candidate", ({ to, candidate }) => {
    if (!to) return;

    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  // =====================================
  // TEXT CHAT
  // NOTE: Frontend sends { to, message }
  // =====================================

  socket.on("send-message", ({ to, message }) => {
    if (!to) return;

    if (!message || !message.trim()) {
      return;
    }

    io.to(to).emit("receive-message", {
      message: message,
    });
  });

  // =====================================
  // TYPING STARTED
  // NOTE: Frontend sends { to }
  // =====================================

  socket.on("typing", ({ to }) => {
    if (!to) return;

    io.to(to).emit("stranger-typing");
  });

  // =====================================
  // TYPING STOPPED
  // NOTE: Frontend sends { to }
  // =====================================

  socket.on("stop-typing", ({ to }) => {
    if (!to) return;

    io.to(to).emit("stranger-stop-typing");
  });

  // =====================================
  // REPORT STRANGER
  // NOTE: Frontend sends { strangerId, reason }
  // =====================================

  socket.on("report-user", ({ strangerId, reason }) => {
    if (!strangerId || !reason) {
      return;
    }

    const report = {
      reporter: socket.id,
      reportedUser: strangerId,
      reason: reason,
      time: new Date(),
    };

    reports.push(report);

    console.log("REPORT RECEIVED:", report);

    socket.emit("report-success");
  });

  // =====================================
  // BLOCK STRANGER
  // NOTE: Frontend sends { strangerId }
  // =====================================

  socket.on("block-user", ({ strangerId }) => {
    if (!strangerId) return;

    const currentUser = users.get(socket.id);

    const stranger = users.get(strangerId);

    if (!currentUser) return;

    if (!currentUser.blockedUsers.includes(strangerId)) {
      currentUser.blockedUsers.push(strangerId);
    }

    if (currentUser.strangerId === strangerId) {
      currentUser.strangerId = null;
    }

    if (stranger) {
      stranger.strangerId = null;
    }

    io.to(strangerId).emit("stranger-blocked");

    socket.emit("block-success");

    console.log(socket.id, "blocked", strangerId);
  });

  // =====================================
  // NEXT
  // =====================================

  socket.on("next", () => {
    console.log("NEXT clicked:", socket.id);

    const currentUser = users.get(socket.id);

    if (!currentUser) {
      return;
    }

    const oldStrangerId = currentUser.strangerId;

    currentUser.strangerId = null;

    // Remember old stranger
    if (oldStrangerId) {
      saveRecentPartner(socket.id, oldStrangerId);

      saveRecentPartner(oldStrangerId, socket.id);

      const oldStranger = users.get(oldStrangerId);

      if (oldStranger) {
        oldStranger.strangerId = null;
      }

      io.to(oldStrangerId).emit("stranger-left");
    }

    removeFromWaiting(socket.id);

    waitingUsers.push(socket.id);

    socket.emit("waiting");

    sendWaitingCount();

    console.log("User waiting after Next:", socket.id);
  });

  // =====================================
  // DISCONNECT
  // =====================================

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    removeFromWaiting(socket.id);

    const currentUser = users.get(socket.id);

    if (currentUser && currentUser.strangerId) {
      const strangerId = currentUser.strangerId;

      const stranger = users.get(strangerId);

      if (stranger) {
        stranger.strangerId = null;
      }

      saveRecentPartner(strangerId, socket.id);

      io.to(strangerId).emit("stranger-left");
    }

    recentPartners.delete(socket.id);

    users.delete(socket.id);

    sendWaitingCount();
  });
});

// =====================================
// TEST ROUTE
// =====================================

app.get("/", (req, res) => {
  res.send("Random Video Chat Server is running");
});

// =====================================
// START SERVER
// =====================================

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});