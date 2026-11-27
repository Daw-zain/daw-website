/**
 * Subscription dates. The database stores UTC instants; people pick calendar days in Libya (UTC+2, no
 * daylight saving): a subscription "valid until" a day ends when that day ends.
 */
const LIBYA = 2 * 3600 * 1000;
const parse = (v: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`).getTime();

/** the day a subscription starts on, as yyyy-mm-dd */
export const fromUtcDay = (v: string | null | undefined) => (v ? new Date(parse(v) + LIBYA).toISOString().slice(0, 10) : "");
/** the last day a subscription is valid, as yyyy-mm-dd (the stored instant is the following midnight) */
export const untilDay = (v: string | null | undefined) => (v ? new Date(parse(v) + LIBYA - 1).toISOString().slice(0, 10) : "");
