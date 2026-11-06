'use client';

import { useActionState } from 'react';
import { confirmTaskAction, unlockTaskAction, matchTaskAction, deleteTaskAction } from './match-actions';
import { updateTaskAction, type ActionState } from '../../task-actions';
import ConfirmSubmit from '@/components/confirm-submit';

export default function LifecyclePanel({
  taskId,
  status,
  allowSameDayMultiple,
  areaCoverage = 'shared',
  maxAreasPerPerson = 2,
  lessDefaultMax = null,
  matchSeed,
  name,
  description,
  fillDeadline,
  manualCount = 0,
}: {
  taskId: string;
  status: string;
  allowSameDayMultiple: boolean;
  areaCoverage?: 'shared' | 'exclusive';
  maxAreasPerPerson?: number;
  lessDefaultMax?: number | null;
  matchSeed: number | null;
  name: string;
  description: string;
  fillDeadline: string;
  manualCount?: number;
}) {
  const [confirmState, confirmAction, confirmPending] = useActionState<ActionState, FormData>(confirmTaskAction, {});
  const [unlockState, unlockAction, unlockPending] = useActionState<ActionState, FormData>(unlockTaskAction, {});
  const [matchState, matchAction, matchPending] = useActionState<ActionState, FormData>(matchTaskAction, {});
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(deleteTaskAction, {});
  const [updateState, updateAction, updatePending] = useActionState<ActionState, FormData>(updateTaskAction, {});

  const confirmed = status === 'confirmed' || status === 'matched';

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-title">任务信息</div>
        {updateState.error ? <div className="alert alert-error mb-2">{updateState.error}</div> : null}
        {updateState.ok ? <div className="alert alert-ok mb-2">{updateState.ok}</div> : null}
        <form action={updateAction} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="data-action" value="update-task" />
          <div className="md:col-span-2">
            <label className="label" htmlFor="taskName">
              任务名称
            </label>
            <input id="taskName" name="name" className="input" defaultValue={name} required />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="taskDescription">
              任务说明
            </label>
            <textarea id="taskDescription" name="description" className="input h-20" defaultValue={description} />
          </div>
          <div>
            <label className="label" htmlFor="taskDeadline">
              填写截止时间
            </label>
            <input
              id="taskDeadline"
              name="fillDeadline"
              type="datetime-local"
              className="input"
              defaultValue={fillDeadline}
            />
          </div>
          <div>
            <label className="label" htmlFor="taskAreaCoverage">
              区域分人模式
            </label>
            <select id="taskAreaCoverage" name="areaCoverage" className="input" defaultValue={areaCoverage}>
              <option value="shared">同组可兼顾（一人可覆盖同组多个区域）</option>
              <option value="exclusive">区域独立分人（同一时段只能一个区域）</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="taskMaxAreas">
              每人每时段最多兼顾区域数
            </label>
            <input
              id="taskMaxAreas"
              name="maxAreasPerPerson"
              type="number"
              min={1}
              max={10}
              className="input"
              defaultValue={maxAreasPerPerson}
            />
          </div>
          <div>
            <label className="label" htmlFor="taskLessMax">
              “希望少排”默认上限（可空）
            </label>
            <input
              id="taskLessMax"
              name="lessDefaultMax"
              type="number"
              min={0}
              max={365}
              className="input"
              defaultValue={lessDefaultMax ?? ''}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowSameDayMultiple" defaultChecked={allowSameDayMultiple} />
              允许同一人同一天安排多个班次（仅时间不重叠时）
            </label>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={updatePending}>
              {updatePending ? '保存中…' : '保存任务信息'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">截止确认与自动匹配</div>

        {confirmState.error ? <div className="alert alert-error mb-2">{confirmState.error}</div> : null}
        {confirmState.ok ? <div className="alert alert-ok mb-2">{confirmState.ok}</div> : null}
        {unlockState.error ? <div className="alert alert-error mb-2">{unlockState.error}</div> : null}
        {unlockState.ok ? <div className="alert alert-ok mb-2">{unlockState.ok}</div> : null}
        {matchState.error ? <div className="alert alert-error mb-2">{matchState.error}</div> : null}
        {matchState.ok ? <div className="alert alert-ok mb-2">{matchState.ok}</div> : null}
        {deleteState.error ? <div className="alert alert-error mb-2">{deleteState.error}</div> : null}

        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
          <li>在截止时间后点击「截止并确认」，系统将锁定用户填写。</li>
          <li>确认后出现「自动匹配排班」按钮：先满足首选，不足时用次选补充，绝不安排「无法排班」。</li>
          <li>若存在缺口，只输出缺口报告（不生成排班结果）；若全部满足，可在结果页查看并导出。</li>
        </ol>

        <div className="flex flex-wrap items-start gap-3">
        {!confirmed ? (
          <form action={confirmAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="lifecycleAction" value="confirm" />
            <input type="hidden" name="data-action" value="confirm" />
            <ConfirmSubmit
              className="btn btn-primary"
              message="确认截止？确认后所有用户将无法再修改填写内容（管理员仍可解锁）。"
            >
              {confirmPending ? '处理中…' : '截止并确认'}
            </ConfirmSubmit>
          </form>
        ) : (
          <form action={unlockAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="lifecycleAction" value="unlock" />
            <input type="hidden" name="data-action" value="unlock" />
            <ConfirmSubmit className="btn" message="解锁后用户可以再次修改填写内容，确定解锁吗？（该操作会记入操作日志）">
              {unlockPending ? '处理中…' : '解锁填写'}
            </ConfirmSubmit>
          </form>
        )}

        <form action={matchAction} className="border border-line p-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="lifecycleAction" value="match" />
          <input type="hidden" name="data-action" value="match" />
          <p className="mb-2 text-sm font-bold">自动匹配排班</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="seed">
                随机种子（可留空自动生成）
              </label>
              <input
                id="seed"
                name="seed"
                className="input max-w-[180px]"
                inputMode="numeric"
                defaultValue={matchSeed ?? ''}
                placeholder="例如 20260301"
              />
            </div>
            <ConfirmSubmit
              className="btn btn-primary"
              disabled={matchPending || !confirmed}
              title={confirmed ? '' : '请先截止并确认'}
              message={
                manualCount > 0
                  ? `当前有 ${manualCount} 条手动调整记录，重新匹配会用新结果覆盖全部排班（包括这些手动调整）。确定继续吗？`
                  : '自动匹配会覆盖当前排班结果，确定继续吗？'
              }
            >
              {matchPending ? '匹配中…' : status === 'matched' ? '重新匹配' : '自动匹配排班'}
            </ConfirmSubmit>
          </div>
          <p className="hint mt-2">
            当前设置：{allowSameDayMultiple ? '允许同日多班（仅时间不重叠时）' : '同一人同一天最多一个班次'}。
            固定种子可保证结果可复现；重新匹配会覆盖上一批结果{manualCount > 0 ? `（含 ${manualCount} 条手动调整）` : ''}，请谨慎操作。
          </p>
          {confirmed ? (
            <p className="hint mt-1">
              自动匹配后可在
              <a className="underline" href={`/admin/tasks/${taskId}/result#manual-adjust`}>
                结果页「手动调整」
              </a>
              中人工增删人员、补齐缺口。
            </p>
          ) : null}
        </form>

        <form action={deleteAction} className="border border-danger p-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="lifecycleAction" value="delete" />
          <input type="hidden" name="data-action" value="delete" />
          <p className="mb-2 text-sm font-bold text-danger">删除任务</p>
          <ConfirmSubmit className="btn btn-danger" message="删除任务将同时删除班次、名单、所有提交与排班结果，且不可恢复。确定删除吗？">
            {deletePending ? '处理中…' : '删除该任务'}
          </ConfirmSubmit>
        </form>
        </div>
      </div>
    </div>
  );
}