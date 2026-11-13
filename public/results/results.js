import { mountExplorer } from "/assets/explorer.js";
import { $, api, esc } from "/assets/ui.js";

const root = $("#explorer");

// Logged-in guests get the fuller payload (with who brought what) as soon
// as voting closes; everyone else gets the public one after the reveal.
async function load() {
  try {
    return await api("GET", "/api/results");
  } catch {
    return api("GET", "/pub/results");
  }
}

load()
  .then((data) => {
    mountExplorer(root, data, { official: data.officialMethod });
    if (data.preview) {
      const note = document.createElement("p");
      note.className = "card preview-note";
      note.textContent = "Admin preview: guests can't see results until you set the phase to Voting closed.";
      root.prepend(note);
    }
  })
  .catch((e) => {
    root.innerHTML = `<p class="empty">${esc(e.status === 404 ? "Results will appear here after the party." : e.message)}</p>`;
  });
