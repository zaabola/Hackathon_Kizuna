// Phone numbers as GDA presidents type them -> E.164 (+21698123456). Tunisian mobiles are 8 digits.
// Returns null when the number cannot be a real phone number.
export function toE164(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('00')) d = '+' + d.slice(2)
  if (/^\d{8}$/.test(d)) d = '+216' + d
  else if (/^216\d{8}$/.test(d)) d = '+' + d
  d = d.replace(/^\+2160(?=\d{8}$)/, '+216') // "+216 0 98..." typed out of habit
  if (d.startsWith('+216')) return /^\+216[2-9]\d{7}$/.test(d) ? d : null // Tunisian numbers are exactly 8 digits
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null
}
