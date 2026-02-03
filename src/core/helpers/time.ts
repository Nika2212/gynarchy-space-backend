export const timeToMs = (timeStr: string): number => {
  if (!timeStr) return 0;

  const parts = timeStr.split(':').reverse();
  let milliseconds = 0;

  const multipliers = [
    1000,
    1000 * 60,
    1000 * 60 * 60,
  ];

  parts.forEach((part, index) => {
    const value = parseInt(part, 10);
    if (!isNaN(value) && multipliers[index]) {
      milliseconds += value * multipliers[index];
    }
  });

  return milliseconds;
};
