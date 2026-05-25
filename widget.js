const SETTINGS = {
  mode: "backend",
  refreshMs: 20000,
  title: "FACEIT",
  footerLabel: "discord channels",
  fixedOnlineCount: 97374,
  backendUrl: "https://discord-groups-widget.onrender.com/api/groups",

  discordGuildId: "1091341858090782793",

  manualGroups: [
    {
      name: "Group Alpha",
      members: [
        { name: "deuce", status: "online", game: "Dota 2" },
        { name: "Fiona", status: "idle", game: "Counter-Strike 2" }
      ]
    },
    {
      name: "Group Bravo",
      members: [
        { name: "Nefertum", status: "online", game: "Team Fortress 2" },
        { name: "Vice", status: "dnd", game: "Path of Exile" }
      ]
    }
  ]
};

const elements = {
  groups: document.getElementById("groups"),
  title: document.getElementById("widget-title"),
  counter: document.getElementById("online-counter"),
  footer: document.getElementById("footer-label")
};

function pluralizeUa(count) {
  const n = Math.abs(Number(count)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return "учасників";
  }

  if (n1 > 1 && n1 < 5) {
    return "учасники";
  }

  if (n1 === 1) {
    return "учасник";
  }

  return "учасників";
}

function buildChannel(channel) {
  const type = channel?.type === "text" ? "text" : "voice";
  const name = escapeHtml(channel?.name || "unknown-channel");

  if (type === "text") {
    return `
      <li class="channel-row channel-text">
        <span class="channel-prefix">#</span>
        <span class="channel-name">${name}</span>
      </li>
    `;
  }

  const count = Number(channel?.memberCount || 0);
  const limit = Number(channel?.userLimit || 0);
  const badge = limit > 0 ? `${count}/${limit}` : `${count}`;

  return `
    <li class="channel-row channel-voice">
      <div class="channel-main">
        <span class="channel-prefix">|</span>
        <span class="channel-name">${name}</span>
      </div>
      <span class="channel-badge">${badge}</span>
      <span class="channel-meta">${count} ${pluralizeUa(count)}</span>
    </li>
  `;
}

function buildSection(section) {
  const channels = Array.isArray(section?.channels) ? section.channels : [];
  return `
    <article class="section">
      <h2 class="section-title">${escapeHtml(section?.name || "Channels")}</h2>
      <ul class="channel-list">
        ${channels.map(buildChannel).join("")}
      </ul>
    </article>
  `;
}

function renderSections(sections) {
  const safeSections = Array.isArray(sections) ? sections : [];

  elements.title.textContent = SETTINGS.title;
  elements.footer.textContent = SETTINGS.footerLabel;
  elements.counter.textContent = `${SETTINGS.fixedOnlineCount} online`;

  if (!safeSections.length) {
    elements.groups.innerHTML = `<p class="empty">No channels available</p>`;
    return;
  }

  elements.groups.innerHTML = safeSections.map(buildSection).join("");
}

async function loadDiscordGroups(guildId) {
  const endpoint = `https://discord.com/api/guilds/${guildId}/widget.json`;
  const response = await fetch(endpoint, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Discord widget request failed: ${response.status}`);
  }

  const payload = await response.json();
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const members = Array.isArray(payload.members) ? payload.members : [];

  const membersByChannel = new Map();
  for (const member of members) {
    const channelId = member.channel_id || "no-channel";
    if (!membersByChannel.has(channelId)) {
      membersByChannel.set(channelId, []);
    }

    membersByChannel.get(channelId).push({
      name: member.nick || member.username || "Unknown",
      status: getSafeStatus(member.status),
      game: member.game?.name || ""
    });
  }

  const groups = channels
    .map((channel) => ({
      name: channel?.name || "Unnamed Channel",
      sort: channel?.position ?? Number.MAX_SAFE_INTEGER,
      members: membersByChannel.get(channel.id) || []
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ name, members: groupMembers }) => ({ name, members: groupMembers }));

  const lobbyMembers = membersByChannel.get("no-channel") || [];
  if (lobbyMembers.length) {
    groups.push({ name: "Lobby", members: lobbyMembers });
  }

  return groups;
}

async function loadBackendGroups(endpoint) {
  const response = await fetch(endpoint, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload) {
    throw new Error("Invalid backend payload");
  }

  if (Array.isArray(payload.sections)) {
    return payload.sections.map((section) => ({
      name: section?.name || "Channels",
      channels: Array.isArray(section?.channels)
        ? section.channels.map((channel) => ({
            name: channel?.name || "unknown-channel",
            type: channel?.type || "voice",
            memberCount: Number(channel?.memberCount || 0),
            userLimit: Number(channel?.userLimit || 0)
          }))
        : []
    }));
  }

  if (Array.isArray(payload.groups)) {
    return [
      {
        name: "Voice channels",
        channels: payload.groups.map((group) => ({
          name: group?.name || "unknown-channel",
          type: "voice",
          memberCount: Array.isArray(group?.members) ? group.members.length : 0,
          userLimit: 0
        }))
      }
    ];
  }

  throw new Error("Invalid backend payload");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function refresh() {
  try {
    if (SETTINGS.mode === "backend") {
      if (SETTINGS.backendUrl) {
        const sections = await loadBackendGroups(SETTINGS.backendUrl);
        renderSections(sections);
        return;
      }

      if (SETTINGS.discordGuildId) {
        const groups = await loadDiscordGroups(SETTINGS.discordGuildId);
        const sections = [
          {
            name: "Voice channels",
            channels: groups.map((group) => ({
              name: group.name,
              type: "voice",
              memberCount: Array.isArray(group.members) ? group.members.length : 0,
              userLimit: 0
            }))
          }
        ];
        renderSections(sections);
        return;
      }

      renderSections([]);
      return;
    }

    if (SETTINGS.mode === "discord") {
      if (!SETTINGS.discordGuildId) {
        renderSections([]);
        return;
      }

      const groups = await loadDiscordGroups(SETTINGS.discordGuildId);
      const sections = [
        {
          name: "Voice channels",
          channels: groups.map((group) => ({
            name: group.name,
            type: "voice",
            memberCount: Array.isArray(group.members) ? group.members.length : 0,
            userLimit: 0
          }))
        }
      ];
      renderSections(sections);
      return;
    }

    renderSections([
      {
        name: "Voice channels",
        channels: SETTINGS.manualGroups.map((group) => ({
          name: group.name,
          type: "voice",
          memberCount: Array.isArray(group.members) ? group.members.length : 0,
          userLimit: 0
        }))
      }
    ]);
  } catch (error) {
    elements.groups.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    elements.counter.textContent = "error";
  }
}

refresh();
setInterval(refresh, SETTINGS.refreshMs);
