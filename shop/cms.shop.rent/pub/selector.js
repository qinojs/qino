// Which moments a selector means: "weekday(monday-friday) hour(8-11)". All its parts have to match; a
// range may wrap, "hour(22-7)" is the night. The same on the server and in a calendar.
const NAMES = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const VALUE = {
  weekday: (d) => d.getDay() || 7,
  monthday: (d) => d.getDate(),
  month: (d) => d.getMonth() + 1,
  hour: (d) => d.getHours(),
  minute: (d) => d.getMinutes(),
};
const number = (word) => NAMES[word.trim()] ?? Number(word);
const within = (value, from, to = from) => from <= to ? value >= from && value <= to : value >= from || value <= to;

/** A function telling whether a Date is one of the selector's moments. */
export function timeSelector(selector) {
  const parts = [...selector.toLowerCase().matchAll(/(weekday|monthday|month|hour|minute)\(([^)]*)\)/g)]
    .map(([, type, values]) => [VALUE[type], values.split(",").map((range) => range.split("-").map(number))]);
  return (date) => parts.every(([value, ranges]) => ranges.some(([from, to]) => within(value(date), from, to)));
}
