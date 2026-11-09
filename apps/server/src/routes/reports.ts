import type { ReportInput } from '@khatm/shared';
import type { Router } from 'express';
import type { Deps } from '../http/app.js';
import { handle } from '../http/errors.js';
import { createReportSchema, param, reportsQuery, updateReportSchema } from '../http/schemas.js';
import { currentUser } from '../http/telegramAuth.js';
import { requireMember } from '../services/access.js';
import { createReport, deleteReport, listReports, reportHistory, updateReport } from '../services/reports.js';

export function reportRoutes(router: Router, { database, notifications }: Deps): void {
  const flush = () => {
    void notifications.flushAchievements().catch((e) => console.error('Очередь достижений', e));
  };

  router.get('/groups/:gid/reports', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const query = reportsQuery.parse(req.query);
    const user = currentUser(res);
    const reports = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      return listReports(db, groupId, me, { memberId: query.member_id, limit: query.limit });
    });
    res.json({ reports });
  }));

  router.post('/groups/:gid/reports', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const input = createReportSchema.parse(req.body);
    const user = currentUser(res);
    const result = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      return createReport(db, groupId, me, user.id, input as ReportInput & { clientRequestId: string });
    });
    res.status(result.duplicate ? 200 : 201).json(result);
    flush();
  }));

  router.patch('/groups/:gid/reports/:rid', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const reportId = param(req, 'rid');
    const input = updateReportSchema.parse(req.body);
    const user = currentUser(res);
    const result = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      return updateReport(db, groupId, me, reportId, input as ReportInput);
    });
    res.json(result);
    flush();
  }));

  router.delete('/groups/:gid/reports/:rid', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const reportId = param(req, 'rid');
    const user = currentUser(res);
    await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      await deleteReport(db, groupId, me, reportId);
    });
    res.status(204).end();
  }));

  router.get('/groups/:gid/reports/:rid/history', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const reportId = param(req, 'rid');
    const user = currentUser(res);
    const events = await database.withUser(user.id, async (db) => {
      await requireMember(db, groupId, user.id);
      return reportHistory(db, groupId, reportId);
    });
    res.json({ events });
  }));
}
