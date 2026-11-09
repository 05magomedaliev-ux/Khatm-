import { isIsoDate, isValidTimeZone, MAX_DAILY_MINIMUM, QURAN_PAGES } from '@khatm/shared';
import type { Request } from 'express';
import { z } from 'zod';

const uuid = z.string().uuid('Некорректный идентификатор.');
export const isoDate = z.string().refine(isIsoDate, 'Некорректная дата.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ.');
const page = z.number().int().min(1, `Номер страницы: от 1 до ${QURAN_PAGES}.`).max(QURAN_PAGES, `Номер страницы: от 1 до ${QURAN_PAGES}.`);
const memberName = z.string().trim().min(1, 'Укажите имя.').max(40, 'Имя слишком длинное.');
const groupName = z.string().trim().min(1, 'Укажите название группы.').max(60, 'Название слишком длинное.');
const timezone = z.string().refine(isValidTimeZone, 'Неизвестный часовой пояс.');
const dailyMinimum = z.number().int().min(1, 'Норма — не меньше одной страницы.').max(MAX_DAILY_MINIMUM);

export function param(req: Request, name: string): string {
  return uuid.parse(req.params[name]);
}

export function inviteCode(req: Request): string {
  return z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Некорректный код приглашения.').parse(req.params.code);
}

const reportBase = z.object({
  kind: z.enum(['count', 'range']),
  pages: z.number().int().min(1, 'Укажите хотя бы одну страницу.').max(QURAN_PAGES, `Не больше ${QURAN_PAGES} страниц в одном отчёте.`).optional(),
  startPage: page.optional(),
  endPage: page.optional(),
  readOn: isoDate,
  note: z.string().trim().max(200, 'Заметка слишком длинная.').nullable().optional(),
  confirmRepeat: z.boolean().optional(),
});

function shapeCheck(value: z.infer<typeof reportBase>, ctx: z.RefinementCtx): void {
  if (value.kind === 'count' && value.pages === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Укажите количество страниц.' });
  }
  if (value.kind === 'range') {
    if (value.startPage === undefined || value.endPage === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Укажите начальную и конечную страницы.' });
    } else if (value.startPage > value.endPage) {
      ctx.addIssue({ code: 'custom', message: 'Начальная страница должна быть не больше конечной.' });
    }
  }
}

export const createReportSchema = reportBase
  .extend({ clientRequestId: uuid })
  .superRefine(shapeCheck);

export const updateReportSchema = reportBase
  .extend({ clientRequestId: uuid.optional() })
  .superRefine(shapeCheck);

export const createGroupSchema = z.object({
  name: groupName,
  timezone,
  dailyMinimum,
  displayName: memberName,
});

export const joinSchema = z
  .object({ memberId: uuid.optional(), displayName: memberName.optional() })
  .refine((v) => v.memberId || v.displayName, 'Выберите имя или укажите своё.');

export const settingsSchema = z.object({
  name: groupName.optional(),
  timezone: timezone.optional(),
  dailyMinimum: dailyMinimum.optional(),
  reminderTime: time.optional(),
  reportTime: time.optional(),
  remindersEnabled: z.boolean().optional(),
  reportsEnabled: z.boolean().optional(),
});

export const memberUpdateSchema = z.object({
  status: z.enum(['active', 'blocked', 'removed']).optional(),
  role: z.enum(['admin', 'member']).optional(),
  startedOn: isoDate.optional(),
  displayName: memberName.optional(),
});

export const addMemberSchema = z.object({ displayName: memberName });

export const notificationsSchema = z.object({
  remindersEnabled: z.boolean().optional(),
  reminderTime: time.nullable().optional(),
  dailyReportEnabled: z.boolean().optional(),
  achievementsEnabled: z.boolean().optional(),
});

export const cardSchema = z.object({
  imageBase64: z.string().min(100).max(5_500_000, 'Изображение слишком большое.'),
});

export const reportsQuery = z.object({
  member_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Некорректный месяц.'),
});
