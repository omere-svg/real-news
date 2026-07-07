/**
 * Fence untrusted text as DATA (ADR-0050/0053). Feed titles/bodies, user
 * messages, web snippets, and tool results are third-party-controlled, so a
 * crafted payload could otherwise read as an instruction. Wrapping it in a
 * tagged block — and telling the model everything inside is data, never
 * commands — closes that. `<` is escaped inside the block so a crafted closing
 * tag (e.g. a headline containing `</item>`) cannot terminate the fence and
 * break out: the fence is a mechanism, not a convention.
 */
export function asData(tag: string, text: string): string {
  return `<${tag}>\n${text.replaceAll('<', '‹')}\n</${tag}>`;
}
