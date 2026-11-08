/* Fills the Departments page dropdowns from the database */
(function () {
  const $ = (id) => document.getElementById(id);

  function fillCampusSelects() {
    const create = $("departmentsCampus");
    if (create) {
      const prev = create.value;
      create.innerHTML =
        `<option value="">Select Campus</option>` + SystemConfig.campusOptionsHtml({ valueKey: "id", selected: prev });
    }

    const filter = $("campusFilter");
    if (filter) {
      const prev = filter.value || "all";
      filter.innerHTML =
        `<option value="all">All Campuses</option>` + SystemConfig.campusOptionsHtml({ valueKey: "id", selected: prev });
    }
  }

  function fillDepartmentNames() {
    const select = $("departmentsName");
    if (!select) return;

    const campusId = $("departmentsCampus")?.value || null;
    const prev = select.value;
    const list = SystemConfig.programsForCampus(campusId);
    const keep = list.some((p) => p.acronym === prev) ? prev : "";

    select.innerHTML =
      `<option value="">Select Department</option>` + SystemConfig.programOptionsHtml({ campus: campusId, selected: keep });

    if (prev && !keep) select.dispatchEvent(new Event("change"));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await SystemConfig.load();
    } catch (error) {
      console.error(error);
      return;
    }
    fillCampusSelects();
    fillDepartmentNames();
    $("departmentsCampus")?.addEventListener("change", fillDepartmentNames);
  });
    // edit cards are created dynamically, so listen on the document
  document.addEventListener("change", (e) => {
    const campusSel = e.target.closest?.(".edit-departments-campus");
    if (!campusSel) return;

    const nameSel = campusSel.closest("form")?.querySelector(".edit-departments-name-input");
    if (!nameSel) return;

    const prev = nameSel.value;
    const stillOffered = SystemConfig.programsForCampus(campusSel.value).some((p) => p.acronym === prev);

    nameSel.innerHTML =
      `<option value="">Select Department</option>` +
      SystemConfig.programOptionsHtml({ campus: campusSel.value, selected: stillOffered ? prev : "" });

    if (prev && !stillOffered) nameSel.dispatchEvent(new Event("change"));
  });
})();