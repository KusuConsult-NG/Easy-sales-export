const { getAllExportRequestsAction } = require("./src/app/actions/admin");
(async () => {
  try {
     console.log("Calling action...");
     const res = await getAllExportRequestsAction("all", 50, undefined);
     console.log("Success:", res.success);
  } catch (e) {
     console.error("CRASHED:", e);
  }
})();
