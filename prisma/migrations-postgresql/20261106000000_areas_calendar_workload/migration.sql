-- v1.3：区域（Area）、工作量偏好、日历缓存/自定义覆盖
-- 说明：PostgreSQL 可直接 ALTER + 回填，无需重建表。

-- 1) 班次日期规则
ALTER TABLE "shifts" ADD COLUMN "dateRule" TEXT;

-- 2) 区域表
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT '默认组',
    "defaultHeadcount" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "areas_shiftId_name_key" ON "areas"("shiftId", "name");
CREATE INDEX "areas_taskId_idx" ON "areas"("taskId");
CREATE INDEX "areas_taskId_groupName_idx" ON "areas"("taskId", "groupName");
ALTER TABLE "areas" ADD CONSTRAINT "areas_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "areas" ADD CONSTRAINT "areas_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) 为既有班次创建默认区域
INSERT INTO "areas" ("id", "taskId", "shiftId", "name", "groupName", "defaultHeadcount", "sortOrder", "createdAt", "updatedAt")
SELECT 'area_' || "id", "taskId", "id", '默认区域', '默认组', "defaultHeadcount", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "shifts";

-- 4) 任务字段
ALTER TABLE "tasks" ADD COLUMN "areaCoverage" TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE "tasks" ADD COLUMN "maxAreasPerPerson" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "tasks" ADD COLUMN "calendarConfig" TEXT;
ALTER TABLE "tasks" ADD COLUMN "lessDefaultMax" INTEGER;

-- 5) 填写人工作量偏好
ALTER TABLE "submissions" ADD COLUMN "workloadPreference" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "submissions" ADD COLUMN "maxAssignments" INTEGER;

-- 6) 需求表加区域并回填
ALTER TABLE "task_day_requirements" ADD COLUMN "areaId" TEXT;
UPDATE "task_day_requirements" old
SET "areaId" = a."id"
FROM "areas" a
WHERE a."shiftId" = old."shiftId" AND a."name" = '默认区域';
ALTER TABLE "task_day_requirements" ALTER COLUMN "areaId" SET NOT NULL;
DROP INDEX IF EXISTS "task_day_requirements_taskId_shiftId_date_key";
CREATE UNIQUE INDEX "task_day_requirements_taskId_shiftId_areaId_date_key"
  ON "task_day_requirements"("taskId", "shiftId", "areaId", "date");
CREATE INDEX "task_day_requirements_taskId_areaId_idx" ON "task_day_requirements"("taskId", "areaId");
ALTER TABLE "task_day_requirements" ADD CONSTRAINT "task_day_requirements_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7) 排班表加区域并回填
ALTER TABLE "assignments" ADD COLUMN "areaId" TEXT;
UPDATE "assignments" old
SET "areaId" = a."id"
FROM "areas" a
WHERE a."shiftId" = old."shiftId" AND a."name" = '默认区域';
ALTER TABLE "assignments" ALTER COLUMN "areaId" SET NOT NULL;
CREATE UNIQUE INDEX "assignments_taskId_date_shiftId_areaId_submissionId_key"
  ON "assignments"("taskId", "date", "shiftId", "areaId", "submissionId");
CREATE INDEX "assignments_taskId_areaId_idx" ON "assignments"("taskId", "areaId");
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) 日历缓存与自定义覆盖
CREATE TABLE "calendar_cache" (
    "year" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "papers" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_cache_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "calendar_overrides" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_overrides_year_date_key" ON "calendar_overrides"("year", "date");
CREATE INDEX "calendar_overrides_year_idx" ON "calendar_overrides"("year");
