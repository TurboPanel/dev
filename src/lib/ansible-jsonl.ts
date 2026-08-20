export type AnsibleJsonlRecord = Record<string, unknown>;

export type ParsedAnsibleJsonl = {
  record: AnsibleJsonlRecord;
  eventType: string;
};

/** Parse a JSONL Ansible callback event into a typed record + `_event` name. */
export function parseAnsibleJsonlRecord(event: unknown): ParsedAnsibleJsonl | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const record = event as AnsibleJsonlRecord;
  const eventType = record._event;
  if (typeof eventType !== "string") {
    return null;
  }
  return { record, eventType };
}
