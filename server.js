import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 30 }));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5-5";

const credits = new Map();
const COST = { text: 1, game: 2, image: 5, video: 30 };

function charge(kind) {
  return (req, res, next) => {
    const user = req.header("x-user-id") || "demo";
    if (!credits.has(user)) credits.set(user, 100);
    if (credits.get(user) < COST[kind])
      return res.status(402).json({ error: "Créditos insuficientes" });
    credits.set(user, credits.get(user) - COST[kind]);
    req.user = user;
    next();
  };
}

async function ask(system, prompt) {
  const r = await claude.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

app.post("/api/text", charge("text"), async (req, res) => {
  try {
    const text = await ask(
      "Você escreve roteiros curtos para vídeo, em português, divididos em cenas com tempo.",
      req.body.prompt
    );
    res.json({ text, credits: credits.get(req.user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/game", charge("game"), async (req, res) => {
  try {
    const { prompt, engine = "Phaser (JavaScript)" } = req.body;
    const text = await ask(
      `Você é um programador de jogos experiente. Gere código completo, comentado e funcional para ${engine}, e explique em poucas linhas como executar.`,
      prompt
    );
    res.json({ text, credits: credits.get(req.user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/image", charge("image"), async (req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-image-1", prompt: req.body.prompt, size: "1024x1024" }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Erro na API de imagem");
    res.json({ b64: data.data[0].b64_json, credits: credits.get(req.user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const jobs = new Map();
app.post("/api/video", charge("video"), (req, res) => {
  const id = crypto.randomUUID();
  jobs.set(id, { status: "pending", prompt: req.body.prompt });
  res.json({ jobId: id, credits: credits.get(req.user) });
});
app.get("/api/video/:id", (req, res) => {
  res.json(jobs.get(req.params.id) || { status: "not_found" });
});

app.listen(process.env.PORT || 3000, () =>
  console.log("AI Studio backend rodando na porta", process.env.PORT || 3000)
);
