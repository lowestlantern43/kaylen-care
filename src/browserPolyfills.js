if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, "flatMap", {
    configurable: true,
    writable: true,
    value(callback, thisArg) {
      return Array.prototype.concat.apply(
        [],
        this.map((item, index, array) => callback.call(thisArg, item, index, array)),
      );
    },
  });
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    configurable: true,
    writable: true,
    value(searchValue, replaceValue) {
      return this.split(searchValue).join(replaceValue);
    },
  });
}
