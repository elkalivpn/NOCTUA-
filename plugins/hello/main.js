module.exports.register = (ctx) => {
  ctx.registerCommand("saludar", () => console.log("Hola desde el plugin " + ctx.id));
  ctx.on("plugin:toggled", ({ payload }) => console.log("plugin toggled:", payload));
};
