export const timeToMs = (timeStr: string): number => {
  if (!timeStr) return 0;

  const parts = timeStr.split(':').reverse();
  let milliseconds = 0;

  // parts[0] is seconds, parts[1] is minutes, parts[2] is hours
  const multipliers = [
    1000, // 1 second
    1000 * 60, // 1 minute
    1000 * 60 * 60, // 1 hour
  ];

  parts.forEach((part, index) => {
    const value = parseInt(part, 10);
    if (!isNaN(value) && multipliers[index]) {
      milliseconds += value * multipliers[index];
    }
  });

  return milliseconds;
};
