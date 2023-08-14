export const debounce = <T, P extends any[], R>(fn: (this: T, ...args: P) => R, ms = 300) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return <typeof fn>function (this, ...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
};
