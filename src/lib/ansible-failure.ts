const ANSIBLE_STDERR_KEYS = ["stderr", "module_stderr"] as const;
const ANSIBLE_STDOUT_KEYS = ["stdout", "module_stdout"] as const;
const ANSIBLE_FAILURE_DETAIL_MAX = 4000;

function firstNonEmptyString(
  result: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function clipAnsibleDetail(text: string): string {
  if (text.length <= ANSIBLE_FAILURE_DETAIL_MAX) {
    return text;
  }
  return text.slice(-ANSIBLE_FAILURE_DETAIL_MAX);
}

/** Ansible `command`/`shell` failures often set `msg` to "non-zero return code". */
export function formatAnsibleHostFailure(
  hosts: Record<string, Record<string, unknown>>,
): string {
  const messages: string[] = [];
  for (const result of Object.values(hosts)) {
    const msg = typeof result.msg === "string" ? result.msg.trim() : "";
    const detail =
      firstNonEmptyString(result, ANSIBLE_STDERR_KEYS) ||
      firstNonEmptyString(result, ANSIBLE_STDOUT_KEYS);
    if (msg && detail && !detail.includes(msg)) {
      messages.push(`${msg}\n${clipAnsibleDetail(detail)}`);
    } else if (detail) {
      messages.push(clipAnsibleDetail(detail));
    } else if (msg) {
      messages.push(msg);
    }
  }
  return messages.join("\n\n") || "task failed";
}
