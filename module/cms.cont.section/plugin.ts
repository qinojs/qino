const settingsSchema = {
  properties: {
    heading: { type: "string", enum: ["h1", "h2", "h3", "h4", "h5", "h6"], default: "h2", description: "Tag of the title." },
  },
};

export const cms = {
  node: {
    css: ["pub/main.css"],
    settingsSchema,
  },
};
