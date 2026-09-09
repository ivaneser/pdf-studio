import CharCodes from "./CharCodes.js";
import { IsDelimiter } from "./Delimiters.js";
import { IsWhitespace } from "./Whitespace.js";
export var IsIrregular = new Uint8Array(256);
for (var idx = 0, len = 256; idx < len; idx++) {
    IsIrregular[idx] = IsWhitespace[idx] || IsDelimiter[idx] ? 1 : 0;
}
IsIrregular[CharCodes.Hash] = 1;
//# sourceMappingURL=Irregular.js.map