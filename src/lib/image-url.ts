/** O endereço da versão menor de uma imagem: "...-cover.webp" -> "...-cover-small.webp". */
export const smallVariant = (url: string) => url.replace(/\.webp$/, "-small.webp");
