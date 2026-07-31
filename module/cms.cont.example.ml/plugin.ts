export const name = "cms.cont.example.ml";
export const description = "Declarative CMS template example with text, images, and nested content.";
export const needs = ["cms", "cms.image2", "cms.templateParser"];

export const cms = {
  node: {
    css: ["pub/main.css"],
  },
};
