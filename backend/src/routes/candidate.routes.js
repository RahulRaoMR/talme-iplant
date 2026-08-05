const router = require("express").Router();
const candidateController = require("../controllers/candidate.controller");

router.post("/candidates", candidateController.createCandidate);
router.get("/candidates", candidateController.getAllCandidates);
router.get("/candidates/search", candidateController.searchCandidates);
router.get("/candidates/:id", candidateController.getCandidateById);
router.put("/candidates/:id", candidateController.updateCandidate);
router.delete("/candidates/:id", candidateController.deleteCandidate);

module.exports = router;
