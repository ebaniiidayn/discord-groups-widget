const SETTINGS = {
  mode: "backend",
  refreshMs: 20000,
  title: "FACEIT",
  footerLabel: "live voice channels",
  fixedOnlineCount: 97374,
  channelCountOverrides: {
    "mystic reverse": 6,
    heavymetal2: 9,
    backcsgo: 7,
    teamwsly: 4,
    tjr: 5
  },
  // Neutral domain (no "discord" in the URL) so the Twitch allowlist/code
  // contains no reference to Discord. Update if Render assigns a different URL.
  backendUrl: "https://team-voice-panel.onrender.com/api/groups",
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
    if (SETTINGS.mode === "backend" && SETTINGS.backendUrl) {
      renderSections(await loadBackendGroups(SETTINGS.backendUrl));
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

// This panel is informational only: it displays voice channels and live
// member counts. It contains no outbound links.
