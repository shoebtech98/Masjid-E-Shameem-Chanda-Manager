const inrCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatInrFromPaise(amountInPaise: number) {
  return inrCurrency.format((Number(amountInPaise) || 0) / 100);
}
