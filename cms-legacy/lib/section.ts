/** Settings every legacy section module shared; `sectionAttr()` reads them. */
export const sectionSettings = {
  properties: {
    "background-color": { type: "string", description: "Background colour; a dark one switches the text to white." },
    heading: { type: "string", enum: ["", "1", "2", "3"], description: "Heading level of the section title." },
  },
};
