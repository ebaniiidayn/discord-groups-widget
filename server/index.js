import express from "express";
import cors from "cors";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";

const TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const GUILD_ID = (process.env.DISCORD_GUILD_ID || "").trim();
const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const REFRESH_MS = Number(process.env.REFRESH_MS || 15000);
const hasConfig = Boolean(TOKEN && GUILD_ID);

const app = express();

// Twitch serves the extension iframe from https://<extension_id>.ext-twitch.tv,
// so we must allow that origin in addition to any explicitly configured ones.
const allowedOrigins = ALLOWED_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (ALLOWED_ORIGIN === "*" || allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(".ext-twitch.tv") || hostname === "ext-twitch.tv";
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin))
  })
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ]
});

let isReady = false;
let cachedPayload = { sections: [] };
let lastUpdated = 0;
let lastError = "";

async function buildGroups() {
  const guild = client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID));
  await guild.channels.fetch();
  await guild.members.fetch().catch(() => null);

  const categorySort = new Map();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      categorySort.set(channel.id, channel.rawPosition);
    }
  }

  const voiceCounts = new Map();
  for (const voiceState of guild.voiceStates.cache.values()) {
    if (!voiceState.channelId) {
      continue;
    }

    const current = voiceCounts.get(voiceState.channelId) || 0;
    voiceCounts.set(voiceState.channelId, current + 1);
  }

  const sections = new Map();

  function sectionFor(channel, fallbackName) {
    const sectionId = channel.parentId || fallbackName;
    if (!sections.has(sectionId)) {
      sections.set(sectionId, {
        id: sectionId,
        name: channel.parent?.name || fallbackName,
        sort: channel.parentId ? (categorySort.get(channel.parentId) ?? 10000) : 10001,
        channels: []
      });
    }

    return sections.get(sectionId);
  }

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      const section = sectionFor(channel, "Text channels");
      section.channels.push({
        id: channel.id,
        name: channel.name,
        type: "text",
        sort: channel.rawPosition
      });
      continue;
    }

    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      const section = sectionFor(channel, "Voice channels");
      section.channels.push({
        id: channel.id,
        name: channel.name,
        type: "voice",
        sort: channel.rawPosition,
        memberCount: voiceCounts.get(channel.id) || 0,
        userLimit: channel.userLimit || 0
      });
    }
  }

  return Array.from(sections.values())
    .map((section) => ({
      name: section.name,
      sort: section.sort,
      channels: section.channels
        .sort((a, b) => a.sort - b.sort)
        .map(({ id, name, type, memberCount, userLimit }) => ({
          id,
          name,
          type,
          memberCount: memberCount || 0,
          userLimit: userLimit || 0
        }))
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ name, channels }) => ({ name, channels }));
}

async function refreshGroupsCache() {
  if (!isReady) {
    return;
  }

  try {
    const sections = await buildGroups();
    cachedPayload = { sections };
    lastUpdated = Date.now();
    lastError = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    lastError = message;
    console.error(`Failed to refresh groups: ${message}`);
  }
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ready: isReady,
    configured: hasConfig,
    lastUpdated,
    lastError
  });
});

app.get("/", (req, res) => {
  res.json({
    service: "discord-groups-backend",
    configured: hasConfig,
    ready: isReady,
    endpoints: ["/health", "/api/groups"]
  });
});

app.get("/api/groups", async (req, res) => {
  if (!hasConfig) {
    res.status(500).json({ error: "Missing DISCORD_TOKEN or DISCORD_GUILD_ID" });
    return;
  }

  if (!isReady) {
    res.status(503).json({ error: "Discord client is not ready" });
    return;
  }

  if (!Array.isArray(cachedPayload.sections) || cachedPayload.sections.length === 0) {
    await refreshGroupsCache();
  }

  if ((!Array.isArray(cachedPayload.sections) || cachedPayload.sections.length === 0) && lastError) {
    res.status(500).json({ error: lastError });
    return;
  }

  res.json({ ...cachedPayload, lastUpdated, lastError });
});

client.once("ready", async () => {
  isReady = true;
  console.log(`Discord bot is ready as ${client.user?.tag || "unknown"}`);
  await refreshGroupsCache();
  setInterval(refreshGroupsCache, REFRESH_MS);
});

if (hasConfig) {
  client.login(TOKEN);
} else {
  console.error("Missing DISCORD_TOKEN or DISCORD_GUILD_ID");
}

app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`);
});
