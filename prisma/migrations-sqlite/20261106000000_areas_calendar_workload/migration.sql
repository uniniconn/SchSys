-- AlterTable
ALTER TABLE "shifts" ADD COLUMN "dateRule" TEXT;

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT '默认组',
    "defaultHeadcount" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "areas_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "areas_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 为既有班次创建默认区域，供历史需求/排班回填
INSERT INTO "areas" ("id", "taskId", "shiftId", "name", "groupName", "defaultHeadcount", "sortOrder", "createdAt", "updatedAt")
SELECT 'area_' || "id", "taskId", "id", '默认区域', '默认组', "defaultHeadcount", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "shifts";


-- CreateTable
CREATE TABLE "calendar_cache" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "papers" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "calendar_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "historyCount" INTEGER NOT NULL DEFAULT 0,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_assignments" ("id", "taskId", "shiftId", "areaId", "date", "submissionId", "name", "source", "batchId", "seed", "historyCount", "manual", "note", "createdAt")
SELECT old."id", old."taskId", old."shiftId", a."id", old."date", old."submissionId", old."name", old."source", old."batchId", old."seed", old."historyCount", old."manual", old."note", old."createdAt"
FROM "assignments" old JOIN "areas" a ON a."shiftId" = old."shiftId" AND a."name" = '默认区域';
DROP TABLE "assignments";
ALTER TABLE "new_assignments" RENAME TO "assignments";
CREATE INDEX "assignments_taskId_date_idx" ON "assignments"("taskId", "date");
CREATE INDEX "assignments_taskId_batchId_idx" ON "assignments"("taskId", "batchId");
CREATE INDEX "assignments_taskId_areaId_idx" ON "assignments"("taskId", "areaId");
CREATE UNIQUE INDEX "assignments_taskId_date_shiftId_areaId_submissionId_key" ON "assignments"("taskId", "date", "shiftId", "areaId", "submissionId");
CREATE TABLE "new_submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "empNo" TEXT,
    "dept" TEXT,
    "onRoster" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "workloadPreference" TEXT NOT NULL DEFAULT 'normal',
    "maxAssignments" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submissions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_submissions" ("createdAt", "dept", "empNo", "id", "ipAddress", "name", "nameKey", "onRoster", "status", "taskId", "updatedAt", "userAgent") SELECT "createdAt", "dept", "empNo", "id", "ipAddress", "name", "nameKey", "onRoster", "status", "taskId", "updatedAt", "userAgent" FROM "submissions";
DROP TABLE "submissions";
ALTER TABLE "new_submissions" RENAME TO "submissions";
CREATE INDEX "submissions_taskId_idx" ON "submissions"("taskId");
CREATE UNIQUE INDEX "submissions_taskId_nameKey_key" ON "submissions"("taskId", "nameKey");
CREATE TABLE "new_task_day_requirements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "task_day_requirements_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_day_requirements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_day_requirements_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_task_day_requirements" ("id", "taskId", "shiftId", "areaId", "date", "headcount", "createdAt", "updatedAt")
SELECT old."id", old."taskId", old."shiftId", a."id", old."date", old."headcount", old."createdAt", old."updatedAt"
FROM "task_day_requirements" old JOIN "areas" a ON a."shiftId" = old."shiftId" AND a."name" = '默认区域';
DROP TABLE "task_day_requirements";
ALTER TABLE "new_task_day_requirements" RENAME TO "task_day_requirements";
CREATE INDEX "task_day_requirements_taskId_date_idx" ON "task_day_requirements"("taskId", "date");
CREATE INDEX "task_day_requirements_taskId_areaId_idx" ON "task_day_requirements"("taskId", "areaId");
CREATE UNIQUE INDEX "task_day_requirements_taskId_shiftId_areaId_date_key" ON "task_day_requirements"("taskId", "shiftId", "areaId", "date");
CREATE TABLE "new_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dateStart" TEXT NOT NULL,
    "dateEnd" TEXT NOT NULL,
    "fillDeadline" DATETIME,
    "fillPasswordHash" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "allowSameDayMultiple" BOOLEAN NOT NULL DEFAULT false,
    "areaCoverage" TEXT NOT NULL DEFAULT 'shared',
    "maxAreasPerPerson" INTEGER NOT NULL DEFAULT 2,
    "calendarConfig" TEXT,
    "lessDefaultMax" INTEGER,
    "matchSeed" INTEGER,
    "matchFeasible" BOOLEAN,
    "matchSummary" TEXT,
    "lastMatchedAt" DATETIME,
    "confirmedAt" DATETIME,
    "confirmedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_tasks" ("allowSameDayMultiple", "confirmedAt", "confirmedBy", "createdAt", "dateEnd", "dateStart", "description", "fillDeadline", "fillPasswordHash", "id", "lastMatchedAt", "matchFeasible", "matchSeed", "matchSummary", "name", "publicToken", "status", "updatedAt") SELECT "allowSameDayMultiple", "confirmedAt", "confirmedBy", "createdAt", "dateEnd", "dateStart", "description", "fillDeadline", "fillPasswordHash", "id", "lastMatchedAt", "matchFeasible", "matchSeed", "matchSummary", "name", "publicToken", "status", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
CREATE UNIQUE INDEX "tasks_publicToken_key" ON "tasks"("publicToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "areas_taskId_idx" ON "areas"("taskId");

-- CreateIndex
CREATE INDEX "areas_taskId_groupName_idx" ON "areas"("taskId", "groupName");

-- CreateIndex
CREATE UNIQUE INDEX "areas_shiftId_name_key" ON "areas"("shiftId", "name");

-- CreateIndex
CREATE INDEX "calendar_overrides_year_idx" ON "calendar_overrides"("year");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_overrides_year_date_key" ON "calendar_overrides"("year", "date");

