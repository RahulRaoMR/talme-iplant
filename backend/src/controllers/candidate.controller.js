const candidateService = require("../services/candidate.service");

async function createCandidate(req, res, next) {
  try {
    const candidate = await candidateService.createCandidate(req.body);
    res.status(201).json({
      success: true,
      message: "Candidate created successfully",
      data: candidate
    });
  } catch (error) {
    next(error);
  }
}

async function getAllCandidates(req, res, next) {
  try {
    const result = await candidateService.getAllCandidates(req.query);
    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
}

async function searchCandidates(req, res, next) {
  try {
    const result = await candidateService.searchCandidates(req.query);
    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
}

async function getCandidateById(req, res, next) {
  try {
    const candidate = await candidateService.getCandidateById(req.params.id);
    res.status(200).json({
      success: true,
      data: candidate
    });
  } catch (error) {
    next(error);
  }
}

async function updateCandidate(req, res, next) {
  try {
    const candidate = await candidateService.updateCandidate(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Candidate updated successfully",
      data: candidate
    });
  } catch (error) {
    next(error);
  }
}

async function deleteCandidate(req, res, next) {
  try {
    await candidateService.deleteCandidate(req.params.id);
    res.status(200).json({
      success: true,
      message: "Candidate deleted successfully"
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createCandidate,
  getAllCandidates,
  searchCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate
};
