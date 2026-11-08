document.addEventListener("DOMContentLoaded", async () => {
  try {
    await SystemConfig.load();
  } catch (error) {
    console.error(error);
    return;
  }

  const esc = SystemConfig.esc;

  const select = document.getElementById("editVoterCampus");
  if (select) {
    const prev = select.value;
    select.innerHTML =
      `<option value="">Select Campus</option>` + SystemConfig.campusOptionsHtml({ valueKey: "id", selected: prev });
  }

  // campus filter checkboxes (values stay campus names, like before)
  const first = document.querySelector('#filtersPanel input[data-filter-type="campus"]');
  const container = first?.closest("label")?.parentElement;
  if (container) {
    container.innerHTML = SystemConfig.campuses()
      .map(
        (c) => `
          <label class="filter-check">
            <input type="checkbox" value="${esc(c.name)}" data-filter-type="campus" />
            <span>${esc(c.name)}</span>
          </label>`,
      )
      .join("");
  }
});