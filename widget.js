const SETTINGS = {
  mode: "discord",
  refreshMs: 30000,
  title: "FACEIT GROUPS",
  footerLabel: "Twitch Channel Widget",

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

const STATUS_CLASS = {
  online: "status-online",
  idle: "status-idle",
  dnd: "status-dnd",
  offline: "status-offline"
};

function getSafeStatus(status) {
  return STATUS_CLASS[status] ? status : "offline";
}

function buildGroup(group) {
  const members = Array.isArray(group.members) ? group.members : [];

  const membersHtml = members.length
    ? members
        .map((member) => {
          const status = getSafeStatus(member.status);
          const game = member.game ? String(member.game) : "";

          return `
            <li class="member-item">
              <div class="member-left">
                <span class="status ${STATUS_CLASS[status]}" aria-hidden="true"></span>
                <span class="member-name">${escapeHtml(member.name || "Unknown")}</span>
              </div>
              <span class="member-meta">${escapeHtml(game)}</span>
            </li>
          `;
        })
        .join("")
    : `<li class="empty">No members in this group</li>`;

  return `
    <article class="group">
      <header class="group-head">
        <h2 class="group-name">${escapeHtml(group.name || "Unnamed Group")}</h2>
        <p class="group-count">${members.length}</p>
      </header>
      <ul class="member-list">
        ${membersHtml}
      </ul>
    </article>
  `;
}

function render(groups) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  const allMembers = normalizedGroups.flatMap((group) => (Array.isArray(group.members) ? group.members : []));

  elements.title.textContent = SETTINGS.title;
  elements.footer.textContent = SETTINGS.footerLabel;
  elements.counter.textContent = `${allMembers.length} online`;

  if (!normalizedGroups.length) {
    elements.groups.innerHTML = `<p class="empty">No groups available</p>`;
    return;
  }

  elements.groups.innerHTML = normalizedGroups.map(buildGroup).join("");
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

  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  return Array.from(membersByChannel.entries())
    .map(([channelId, channelMembers]) => {
      const channel = channelMap.get(channelId);
      return {
        name: channel?.name || "Lobby",
        sort: channel?.position ?? Number.MAX_SAFE_INTEGER,
        members: channelMembers
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map(({ name, members: groupMembers }) => ({ name, members: groupMembers }));
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
    if (SETTINGS.mode === "discord") {
      if (!SETTINGS.discordGuildId) {
        render([]);
        return;
      }

      const groups = await loadDiscordGroups(SETTINGS.discordGuildId);
      render(groups);
      return;
    }

    render(SETTINGS.manualGroups);
  } catch (error) {
    elements.groups.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    elements.counter.textContent = "error";
  }
}

refresh();
setInterval(refresh, SETTINGS.refreshMs);
