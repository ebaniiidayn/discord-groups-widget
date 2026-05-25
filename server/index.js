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
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN }));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ]
});

let isReady = false;
let cachedGroups = [];
let lastUpdated = 0;
let lastError = "";

function normalizeStatus(status) {
  if (status === "online" || status === "idle" || status === "dnd" || status === "offline") {
    return status;
  }

  return "offline";
}

function extractGame(member) {
  const activities = member?.presence?.activities;
  if (!Array.isArray(activities) || activities.length === 0) {
    return "";
  }

  const first = activities.find((a) => typeof a?.name === "string" && a.name.trim().length > 0);
  return first?.name || "";
}

async function buildGroups() {
  const guild = client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID));
  await guild.channels.fetch();
  await guild.members.fetch().catch(() => null);

  const channels = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      sort: channel.rawPosition,
      members: []
    }))
    .sort((a, b) => a.sort - b.sort);

  const map = new Map(channels.map((c) => [c.id, c]));

  for (const voiceState of guild.voiceStates.cache.values()) {
    if (!voiceState.channelId) {
      continue;
    }

    const group = map.get(voiceState.channelId);
    if (!group) {
      continue;
    }

    const { member } = voiceState;
    if (!member) {
      continue;
    }

    group.members.push({
      name: member.displayName || member.user?.username || "Unknown",
      status: normalizeStatus(member.presence?.status),
      game: extractGame(member)
    });
  }

  for (const group of channels) {
    group.members.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }

  return channels.map(({ name, members }) => ({ name, members }));
}

async function refreshGroupsCache() {
  if (!isReady) {
    return;
  }

  try {
    const groups = await buildGroups();
    cachedGroups = groups;
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

  if (cachedGroups.length === 0) {
    await refreshGroupsCache();
  }

  if (cachedGroups.length === 0 && lastError) {
    res.status(500).json({ error: lastError });
    return;
  }

  res.json({ groups: cachedGroups, lastUpdated, lastError });
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
