const SETTINGS = {
  mode: "backend",
  refreshMs: 20000,
  title: "FACEIT",
  footerLabel: "discord channels",
  fixedOnlineCount: 97374,
  channelCountOverrides: {
    "mystic reverse": 6,
    heavymetal2: 9,
    backcsgo: 7,
    teamwsly: 4,
    tjr: 5
  },
  inviteUrl: "https://discord.gg/faceit",
  backendUrl: "https://discord-groups-widget.onrender.com/api/groups",
  discordGuildId: "1091341858090782793",
  manualGroups: [
    { name: "Group Alpha", members: [{ name: "deuce" }, { name: "Fiona" }] },
    { name: "Group Bravo", members: [{ name: "Nefertum" }, { name: "Vice" }] }
  ]
};

const elements = {
  widget: document.querySelector(".widget"),
  groups: document.getElementById("groups"),
  title: document.getElementById("widget-title"),
  counter: document.getElementById("online-counter"),
  footer: document.getElementById("footer-label")
};

function scrollGroupsToBottom() {
  if (!elements.groups) {
    return;
  }

  requestAnimationFrame(() => {
    elements.groups.scrollTop = elements.groups.scrollHeight;
  });
}

function setupWidgetLink() {
  if (!elements.widget || !SETTINGS.inviteUrl) {
    return;
  }

  const openInvite = () => {
    window.open(SETTINGS.inviteUrl, "_blank", "noopener,noreferrer");
  };

  elements.widget.classList.add("widget-clickable");
  elements.widget.setAttribute("tabindex", "0");
  elements.widget.setAttribute("role", "link");
  elements.widget.setAttribute("aria-label", "Open Discord invite");
  elements.widget.addEventListener("click", openInvite);
  elements.widget.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openInvite();
    }
  });
}

function pluralizeEn(count) {
  return Number(count) === 1 ? "member" : "members";
}

function getDisplayCount(channelName, fallbackCount) {
  const key = String(channelName || "").trim().toLowerCase();
  const value = SETTINGS.channelCountOverrides?.[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return fallbackCount;
}

function buildChannel(channel) {
  const realCount = Number(channel?.memberCount || 0);
  const count = getDisplayCount(channel?.name, realCount);
  const limit = Number(channel?.userLimit || 0);
  const badge = limit > 0 ? `${count}/${limit}` : `${count}`;

  return `
    <li class="channel-row channel-voice">
      <div class="channel-main">
        <span class="channel-prefix">|</span>
        <span class="channel-name">${escapeHtml(channel?.name || "unknown-channel")}</span>
      </div>
      <span class="channel-badge">${badge}</span>
      <span class="channel-meta">${count} ${pluralizeEn(count)}</span>
    </li>
  `;
}

function buildSection(section) {
  const channels = Array.isArray(section?.channels)
    ? section.channels.filter((channel) => channel?.type === "voice")
    : [];

  if (!channels.length) {
    return "";
  }

  return `
    <article class="section">
      <h2 class="section-title">${escapeHtml(section?.name || "Voice channels")}</h2>
      <ul class="channel-list">
        ${channels.map(buildChannel).join("")}
      </ul>
    </article>
  `;
}

function applyChrome() {
  if (elements.title) {
    elements.title.textContent = SETTINGS.title;
  }
  if (elements.footer) {
    elements.footer.textContent = SETTINGS.footerLabel;
  }
  if (elements.counter) {
    const online = Number(SETTINGS.fixedOnlineCount) || 0;
    elements.counter.textContent = `${online.toLocaleString("en-US")} online`;
  }
}

function buildFallbackSections() {
  const entries = Object.entries(SETTINGS.channelCountOverrides || {});
  if (!entries.length) {
    return [];
  }

  return [
    {
      name: "Voice channels",
      channels: entries.map(([name, memberCount]) => ({
        name,
        type: "voice",
        memberCount: Number(memberCount) || 0,
        userLimit: 0
      }))
    }
  ];
}

function renderSections(sections) {
  const safeSections = Array.isArray(sections) ? sections : [];

  applyChrome();

  const html = safeSections.map(buildSection).join("");
  elements.groups.innerHTML = html || `<p class="empty">No voice channels available</p>`;
  scrollGroupsToBottom();
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
    const current = membersByChannel.get(channelId) || 0;
    membersByChannel.set(channelId, current + 1);
  }

  const voiceChannels = channels
    .map((channel) => ({
      name: channel?.name || "Unnamed Channel",
      type: "voice",
      memberCount: membersByChannel.get(channel.id) || 0,
      userLimit: 0,
      sort: channel?.position ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ name, type, memberCount, userLimit }) => ({ name, type, memberCount, userLimit }));

  return [{ name: "Voice channels", channels: voiceChannels }];
}

async function loadBackendGroups(endpoint) {
  const response = await fetch(endpoint, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  const payload = await response.json();

  if (Array.isArray(payload?.sections)) {
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

  if (Array.isArray(payload?.groups)) {
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
        renderSections(await loadBackendGroups(SETTINGS.backendUrl));
        return;
      }

      if (SETTINGS.discordGuildId) {
        renderSections(await loadDiscordGroups(SETTINGS.discordGuildId));
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

      renderSections(await loadDiscordGroups(SETTINGS.discordGuildId));
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
    // Backend unreachable (Render asleep, CSP/CORS, etc.) — never leave the
    // panel blank: fall back to the configured channel list so it still shows.
    const fallback = buildFallbackSections();
    if (fallback.length) {
      renderSections(fallback);
    } else {
      renderSections([]);
    }
  }
}

// Paint the title/footer/counter immediately so the panel is never blank,
// even before the first network request resolves.
applyChrome();
refresh();
setInterval(refresh, SETTINGS.refreshMs);

// NOTE: the click-to-Discord link-out is intentionally disabled.
// Twitch review policy 4.5 rejects Extensions whose principal use is linking
// viewers to an external site (Discord). This panel is now informational only.
// To re-enable for a private Hosted Test build, call setupWidgetLink() here.
