import { Sequelize, DataTypes, Model, Op } from "sequelize";
export type Fields = Record<string, string>;
export type Event = { eventId: string; recordId: string; occurredAt: number; actor: string; changedFields: Fields; correlationId?: string; sequence: number };
export class FieldState extends Model {}
export class InboundEvent extends Model {}
export class ChangeHistory extends Model {}
export class OutboxMessage extends Model {}
export class StalePortalEditError extends Error { constructor(public readonly conflicts: string[]) { super(`stale portal fields: ${conflicts.join(", ")}`); this.name = "StalePortalEditError"; } }
let portalSequence = 0;

export function createDatabase(storage: string): Sequelize {
  const db = new Sequelize({ dialect: "sqlite", storage, logging: false });
  FieldState.init({ recordId: { type: DataTypes.STRING, allowNull: false }, fieldName: { type: DataTypes.STRING, allowNull: false }, value: { type: DataTypes.STRING, allowNull: false }, version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, source: { type: DataTypes.STRING, allowNull: false }, sourceSequence: { type: DataTypes.INTEGER, allowNull: false }, occurredAt: { type: DataTypes.INTEGER, allowNull: false }, actor: { type: DataTypes.STRING, allowNull: false }, correlationId: DataTypes.STRING }, { sequelize: db, modelName: "field_state", indexes: [{ unique: true, fields: ["recordId", "fieldName"] }] });
  InboundEvent.init({ eventId: { type: DataTypes.STRING, allowNull: false, unique: true }, recordId: { type: DataTypes.STRING, allowNull: false }, occurredAt: { type: DataTypes.INTEGER, allowNull: false }, payload: { type: DataTypes.JSON, allowNull: false }, status: { type: DataTypes.STRING, allowNull: false } }, { sequelize: db, modelName: "inbound_event" });
  ChangeHistory.init({ recordId: { type: DataTypes.STRING, allowNull: false }, fieldName: { type: DataTypes.STRING, allowNull: false }, oldValue: DataTypes.STRING, newValue: DataTypes.STRING, source: { type: DataTypes.STRING, allowNull: false }, actor: { type: DataTypes.STRING, allowNull: false }, eventOrMutationId: { type: DataTypes.STRING, allowNull: false }, outcome: { type: DataTypes.STRING, allowNull: false } }, { sequelize: db, modelName: "change_history" });
  OutboxMessage.init({ recordId: { type: DataTypes.STRING, allowNull: false }, changedFields: { type: DataTypes.JSON, allowNull: false }, correlationId: { type: DataTypes.STRING, allowNull: false, unique: true }, status: { type: DataTypes.STRING, allowNull: false }, attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, lastError: DataTypes.STRING }, { sequelize: db, modelName: "outbox_message" });
  return db;
}

export class FakeSalesforce {
  available = true; private sequence = 0;
  constructor(private readonly onWebhook: (event: Event) => Promise<void>) {}
  async update(recordId: string, fields: Fields, correlationId: string): Promise<void> {
    if (!this.available) throw new Error("Salesforce unavailable");
    this.sequence += 1;
    await this.onWebhook({ eventId: `sf-${this.sequence}`, recordId, occurredAt: this.sequence, actor: "salesforce-api", changedFields: fields, correlationId, sequence: this.sequence });
  }
}

export async function applyWebhook(db: Sequelize, event: Event): Promise<"applied" | "duplicate" | "stale"> {
  const tx = await db.transaction();
  try {
    const existing = await InboundEvent.findOne({ where: { eventId: event.eventId }, transaction: tx });
    if (existing) { await tx.commit(); return "duplicate"; }
    await InboundEvent.create({ eventId: event.eventId, recordId: event.recordId, occurredAt: event.occurredAt, payload: event, status: "processing" }, { transaction: tx });
    let applied = false;
    for (const [fieldName, value] of Object.entries(event.changedFields)) {
      const current = await FieldState.findOne({ where: { recordId: event.recordId, fieldName }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (current && (current.get("sourceSequence") as number) >= event.sequence) { await ChangeHistory.create({ recordId: event.recordId, fieldName, oldValue: current.get("value"), newValue: value, source: "SALESFORCE", actor: event.actor, eventOrMutationId: event.eventId, outcome: "stale" }, { transaction: tx }); continue; }
      const oldValue = current?.get("value") as string | undefined;
      if (current) await current.update({ value, version: (current.get("version") as number) + 1, source: "SALESFORCE", sourceSequence: event.sequence, occurredAt: event.occurredAt, actor: event.actor, correlationId: event.correlationId }, { transaction: tx });
      else await FieldState.create({ recordId: event.recordId, fieldName, value, version: 1, source: "SALESFORCE", sourceSequence: event.sequence, occurredAt: event.occurredAt, actor: event.actor, correlationId: event.correlationId }, { transaction: tx });
      await ChangeHistory.create({ recordId: event.recordId, fieldName, oldValue, newValue: value, source: "SALESFORCE", actor: event.actor, eventOrMutationId: event.eventId, outcome: "applied" }, { transaction: tx }); applied = true;
    }
    await InboundEvent.update({ status: "processed" }, { where: { eventId: event.eventId }, transaction: tx }); await tx.commit(); return applied ? "applied" : "stale";
  } catch (error) { if (!(tx as any).finished) await tx.rollback(); throw error; }
}

export async function portalEdit(db: Sequelize, recordId: string, actor: string, fields: Fields, correlationId: string, expectedVersions: Record<string, number | undefined> = {}): Promise<void> {
  const tx = await db.transaction();
  try {
    const sequence = Math.max(Date.now(), portalSequence + 1); portalSequence = sequence;
    const conflicts: string[] = [];
    for (const fieldName of Object.keys(fields)) {
      const current = await FieldState.findOne({ where: { recordId, fieldName }, transaction: tx, lock: tx.LOCK.UPDATE });
      const expected = expectedVersions[fieldName]; const actual = current?.get("version") as number | undefined;
      if (expected !== actual) conflicts.push(fieldName);
    }
    if (conflicts.length) { await tx.rollback(); throw new StalePortalEditError(conflicts); }
    for (const [fieldName, value] of Object.entries(fields)) {
      const current = await FieldState.findOne({ where: { recordId, fieldName }, transaction: tx, lock: tx.LOCK.UPDATE }); const oldValue = current?.get("value") as string | undefined;
      if (current) await current.update({ value, version: (current.get("version") as number) + 1, source: "PORTAL", sourceSequence: sequence, occurredAt: sequence, actor }, { transaction: tx });
      else await FieldState.create({ recordId, fieldName, value, version: 1, source: "PORTAL", sourceSequence: sequence, occurredAt: sequence, actor }, { transaction: tx });
      await ChangeHistory.create({ recordId, fieldName, oldValue, newValue: value, source: "PORTAL", actor, eventOrMutationId: correlationId, outcome: "applied" }, { transaction: tx });
    }
    await OutboxMessage.create({ recordId, changedFields: fields, correlationId, status: "pending", attempts: 0 }, { transaction: tx }); await tx.commit();
  } catch (error) { if (!(tx as any).finished) await tx.rollback(); throw error; }
}

export async function processOutbox(db: Sequelize, sf: FakeSalesforce): Promise<void> {
  const messages = await OutboxMessage.findAll({ where: { status: { [Op.in]: ["pending", "retry"] } }, order: [["id", "ASC"]] });
  for (const message of messages) { await message.update({ status: "sending", attempts: (message.get("attempts") as number) + 1 }); try { await sf.update(message.get("recordId") as string, message.get("changedFields") as Fields, message.get("correlationId") as string); await message.update({ status: "sent", lastError: null }); } catch (error) { await message.update({ status: "retry", lastError: (error as Error).message }); } }
}
export async function field(db: Sequelize, recordId: string, name: string): Promise<string | undefined> { const row = await FieldState.findOne({ where: { recordId, fieldName: name } }); return row?.get("value") as string | undefined; }
export async function fieldVersion(db: Sequelize, recordId: string, name: string): Promise<number | undefined> { const row = await FieldState.findOne({ where: { recordId, fieldName: name } }); return row?.get("version") as number | undefined; }
