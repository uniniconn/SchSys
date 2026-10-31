-- 手动调整排班：标记手动加入的记录并记录调整说明
ALTER TABLE "assignments" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "assignments" ADD COLUMN "note" TEXT;
