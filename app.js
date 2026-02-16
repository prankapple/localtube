const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const db = require("./db");

const app = express();
const PORT = 3000;

// Middlewares
app.set("view engine", "ejs");
app.use(express.static("uploads"));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// Sessions
app.use(session({
  secret: "localyoutube_secret",
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- ROUTES --- //

// Home page with search
app.get("/", (req, res) => {
  let query = req.query.q ? `%${req.query.q}%` : "%";
  db.all("SELECT videos.*, users.username FROM videos JOIN users ON videos.user_id = users.id WHERE videos.title LIKE ? OR videos.description LIKE ? ORDER BY id DESC", [query, query], (err, videos) => {
    if (err) throw err;
    res.render("index", { videos });
  });
});

// Upload
app.get("/upload", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("upload");
});
app.post("/upload", upload.single("video"), (req, res) => {
  const { title, description } = req.body;
  const filename = req.file.filename;
  const user_id = req.session.user.id;
  db.run("INSERT INTO videos (title, description, filename, user_id) VALUES (?, ?, ?, ?)", [title, description, filename, user_id], (err) => {
    if (err) throw err;
    res.redirect("/");
  });
});

// Watch video
app.get("/watch/:id", (req, res) => {
  const videoId = req.params.id;
  db.get("SELECT videos.*, users.username FROM videos JOIN users ON videos.user_id = users.id WHERE videos.id = ?", [videoId], (err, video) => {
    if (err || !video) return res.send("Video not found");

    db.all("SELECT comments.*, users.username FROM comments JOIN users ON comments.user_id = users.id WHERE comments.video_id = ?", [videoId], (err, comments) => {
      db.get("SELECT COUNT(*) as likes FROM likes WHERE video_id = ?", [videoId], (err, likes) => {
        res.render("watch", { video, comments, likes: likes.likes });
      });
    });
  });
});

// Stream video
app.get("/video/:filename", (req, res) => {
  const filePath = path.join(__dirname, "uploads", req.params.filename);
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Like
app.post("/like/:videoId", (req, res) => {
  if (!req.session.user) return res.send("Login required");
  const userId = req.session.user.id;
  const videoId = req.params.videoId;
  db.run("INSERT OR IGNORE INTO likes (user_id, video_id) VALUES (?, ?)", [userId, videoId], () => {
    res.redirect("/watch/" + videoId);
  });
});

// Comment
app.post("/comment/:videoId", (req, res) => {
  if (!req.session.user) return res.send("Login required");
  const userId = req.session.user.id;
  const videoId = req.params.videoId;
  const text = req.body.comment;
  db.run("INSERT INTO comments (user_id, video_id, text) VALUES (?, ?, ?)", [userId, videoId, text], () => {
    res.redirect("/watch/" + videoId);
  });
});

// Register
app.get("/register", (req, res) => res.render("register"));
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], (err) => {
    if (err) return res.send("Username already taken");
    res.redirect("/login");
  });
});

// Login
app.get("/login", (req, res) => res.render("login"));
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (!user) return res.send("Invalid username");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Invalid password");
    req.session.user = user;
    res.redirect("/");
  });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// Start server
app.listen(PORT, () => console.log(`LocalTube running on http://localhost:${PORT}`));
