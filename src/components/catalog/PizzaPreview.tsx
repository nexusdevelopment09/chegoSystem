// Drawing of the pizza split in equal parts, one per chosen flavor.
// Updates live while the customer picks.

const COLORS = ["#E8611A", "#F6B26B", "#B4480F", "#FFD9A8"];
const TEXT_ON = ["#FFFFFF", "#24160C", "#FFFFFF", "#24160C"];

const point = (angle: number, radius: number) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: 100 + radius * Math.cos(radians), y: 100 + radius * Math.sin(radians) };
};

const shorten = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

export function PizzaPreview({ flavors, max }: { flavors: string[]; max: number }) {
  const parts = flavors.length;
  const description =
    parts === 0
      ? `Pizza sem sabor escolhido. Escolha até ${max}.`
      : `Pizza com ${parts} ${parts === 1 ? "sabor" : "sabores"}: ${flavors.join(", ")}.`;

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={description} data-testid="pizza-preview">
        <circle cx="100" cy="100" r="96" fill="#C8792B" />
        <circle cx="100" cy="100" r="86" fill={parts === 0 ? "#FFE9D6" : COLORS[0]} />

        {parts > 1 &&
          flavors.map((flavor, index) => {
            const from = (360 / parts) * index;
            const to = (360 / parts) * (index + 1);
            const start = point(from, 86);
            const end = point(to, 86);
            return (
              <path
                key={`${flavor}-${index}`}
                d={`M100 100 L${start.x} ${start.y} A86 86 0 ${to - from > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`}
                fill={COLORS[index % COLORS.length]}
                stroke="#FFF8F1"
                strokeWidth="2"
              />
            );
          })}

        {parts === 0 && (
          <text x="100" y="105" textAnchor="middle" fontSize="13" fontWeight="700" fill="#5C4632">
            Escolha o sabor
          </text>
        )}

        {flavors.map((flavor, index) => {
          const middle = parts === 1 ? { x: 100, y: 100 } : point((360 / parts) * (index + 0.5), 48);
          const words = shorten(flavor).split(" ");
          const half = Math.ceil(words.length / 2);
          const lines = words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [words[0]];
          return (
            <text
              key={`label-${flavor}-${index}`}
              x={middle.x}
              y={middle.y - (lines.length - 1) * 6}
              textAnchor="middle"
              fontSize={parts > 2 ? 9 : 11}
              fontWeight="700"
              fill={TEXT_ON[index % TEXT_ON.length]}
            >
              {lines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={middle.x} dy={lineIndex === 0 ? 4 : 12}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
      <figcaption className="text-sm text-coffee-soft" data-testid="pizza-caption">
        {parts === 0 ? `Escolha até ${max} ${max === 1 ? "sabor" : "sabores"}` : `${parts} de ${max} ${max === 1 ? "sabor" : "sabores"}`}
      </figcaption>
    </figure>
  );
}
