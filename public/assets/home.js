fetch("/pub/info")
  .then((r) => r.json())
  .then((info) => {
    if (info.revealed) document.getElementById("results-link").hidden = false;
  })
  .catch(() => {});
