const { prisma } = require("../config/prisma");

const editableFields = [
  "fullName",
  "email",
  "phone",
  "location",
  "keywords",
  "experience",
  "currentCompany",
  "currentDesignation",
  "resumeUrl",
  "profileImage"
];

const sortableFields = new Set([
  "fullName",
  "email",
  "phone",
  "location",
  "experience",
  "currentCompany",
  "currentDesignation",
  "createdAt",
  "updatedAt"
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function getPaginationOptions(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const sortBy = sortableFields.has(query.sortBy) ? query.sortBy : "createdAt";
  const order = String(query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const skip = (page - 1) * limit;

  return { page, limit, sortBy, order, skip };
}

function parseExperienceRange(query) {
  const experience = {};
  const hasMin = query.experienceMin !== undefined && query.experienceMin !== "";
  const hasMax = query.experienceMax !== undefined && query.experienceMax !== "";

  if (hasMin) {
    const min = Number(query.experienceMin);
    if (Number.isNaN(min) || min < 0) {
      throw createHttpError(400, "experienceMin must be a positive number");
    }
    experience.gte = min;
  }

  if (hasMax) {
    const max = Number(query.experienceMax);
    if (Number.isNaN(max) || max < 0) {
      throw createHttpError(400, "experienceMax must be a positive number");
    }
    experience.lte = max;
  }

  if (experience.gte !== undefined && experience.lte !== undefined && experience.gte > experience.lte) {
    throw createHttpError(400, "experienceMin cannot be greater than experienceMax");
  }

  return experience;
}

function buildCandidateSearchWhere(query) {
  const where = {};
  const keyword = normalizeString(query.keyword);
  const location = normalizeString(query.location);
  const experience = parseExperienceRange(query);

  if (keyword) {
    where.OR = [
      { fullName: { contains: keyword, mode: "insensitive" } },
      { keywords: { contains: keyword, mode: "insensitive" } },
      { currentCompany: { contains: keyword, mode: "insensitive" } },
      { currentDesignation: { contains: keyword, mode: "insensitive" } }
    ];
  }

  if (location) {
    where.location = { contains: location, mode: "insensitive" };
  }

  if (Object.keys(experience).length) {
    where.experience = experience;
  }

  return where;
}

function normalizeCandidateInput(input, partial = false) {
  const data = {};

  for (const field of editableFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      data[field] = normalizeString(input[field]);
    }
  }

  if (data.email === "") data.email = null;

  if (Object.prototype.hasOwnProperty.call(data, "experience")) {
    if (data.experience === "" || data.experience == null) {
      data.experience = null;
    } else {
      const experience = Number(data.experience);
      if (Number.isNaN(experience) || experience < 0) {
        throw createHttpError(400, "Experience must be a positive number");
      }
      data.experience = experience;
    }
  }

  if (!partial) {
    for (const field of ["fullName", "phone", "location", "keywords"]) {
      if (!data[field]) {
        throw createHttpError(400, `${field} is required`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "email") && data.email && !isValidEmail(data.email)) {
    throw createHttpError(400, "Invalid email format");
  }

  return data;
}

async function assertUniqueCandidateFields({ email, phone }, excludeId = null) {
  const conditions = [];
  if (email) conditions.push({ email });
  if (phone) conditions.push({ phone });
  if (!conditions.length) return;

  const existing = await prisma.candidate.findFirst({
    where: {
      OR: conditions,
      ...(excludeId ? { NOT: { id: excludeId } } : {})
    },
    select: { email: true, phone: true }
  });

  if (!existing) return;
  if (phone && existing.phone === phone) {
    throw createHttpError(409, "Phone already exists");
  }
  if (email && existing.email === email) {
    throw createHttpError(409, "Email already exists");
  }
}

async function createCandidate(payload) {
  const data = normalizeCandidateInput(payload);
  await assertUniqueCandidateFields(data);
  return prisma.candidate.create({ data });
}

async function getAllCandidates(query) {
  const { page, limit, sortBy, order, skip } = getPaginationOptions(query);

  const [data, total] = await Promise.all([
    prisma.candidate.findMany({
      skip,
      take: limit,
      orderBy: { [sortBy]: order }
    }),
    prisma.candidate.count()
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

async function searchCandidates(query) {
  const { page, limit, sortBy, order, skip } = getPaginationOptions(query);
  const where = buildCandidateSearchWhere(query);

  const [data, total] = await Promise.all([
    prisma.candidate.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: order }
    }),
    prisma.candidate.count({ where })
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

async function getCandidateById(id) {
  const candidate = await prisma.candidate.findUnique({ where: { id } });
  if (!candidate) {
    throw createHttpError(404, "Candidate not found");
  }
  return candidate;
}

async function updateCandidate(id, payload) {
  await getCandidateById(id);
  const data = normalizeCandidateInput(payload, true);

  if (!Object.keys(data).length) {
    throw createHttpError(400, "No editable fields provided");
  }

  await assertUniqueCandidateFields(data, id);

  return prisma.candidate.update({
    where: { id },
    data
  });
}

async function deleteCandidate(id) {
  await getCandidateById(id);
  await prisma.candidate.delete({ where: { id } });
}

module.exports = {
  createCandidate,
  getAllCandidates,
  searchCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate
};
