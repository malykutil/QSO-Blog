import { AppShell } from "@/app/components/app-shell";

const focusAreas = ["provoz na pásmech", "digitální módy", "ladění antén", "vlastní zkušenosti z praxe"];

export default function AboutPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0b1421_0%,_#14304b_45%,_#1f5f8f_100%)] px-6 py-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.18)] md:px-8 md:py-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,_rgba(255,164,93,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_28%)]" />
          <div className="relative max-w-4xl">
            <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">O mně</p>
            <h1 className="mt-5 font-display text-6xl leading-[0.92] md:text-7xl">Jakub / OK2MKJ</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-sky-50/80">
              Radioamatérství je pro mě víc než jen koníček. Je to způsob, jak být ve spojení se světem, i když zrovna
              sedím doma u stanice.
            </p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="glass-panel rounded-[2.2rem] p-6 md:p-8">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Můj příběh</p>
            <h2 className="mt-3 font-display text-5xl leading-none text-slate-950">Jak jsem se dostal k rádiu</h2>
            <div className="mt-6 space-y-5 text-base leading-8 text-slate-700">
              <p>
                Jmenuju se Jakub a radioamatérství je pro mě víc než jen koníček – je to způsob, jak být ve spojení se
                světem, i když zrovna sedím doma u stanice. V éteru vystupuju pod značkou OK2MKJ a nejvíc mě baví
                objevovat, kam až se dá s jednoduchým vybavením „dosáhnout“.
              </p>
              <p>
                Začínal jsem klasicky – posloucháním, prvním vysíláním, zkoušením antén a postupně i jejich stavbou.
                Hodně mě baví technická stránka věci – ladění antén, experimentování a hledání, co funguje líp. Není to
                vždycky podle tabulek, ale právě to na tom dělá tu zábavu.
              </p>
              <p>
                Na blogu chci sdílet svoje zkušenosti z praxe – co se povedlo, co ne, konkrétní rozměry, postupy a
                reálné výsledky. Žádná teorie od stolu, ale věci, které jsem si sám vyzkoušel. Třeba stavby antén,
                úpravy vybavení nebo poznatky z provozu.
              </p>
              <p>
                Radioamatérství pro mě není jen o technice, ale i o lidech. Každé spojení má svůj příběh a nikdy
                nevíš, kdo se ozve na druhé straně.
              </p>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="glass-panel rounded-[2.2rem] p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Zaměření</p>
              <div className="mt-5 space-y-3">
                {focusAreas.map((item) => (
                  <div
                    key={item}
                    className="rounded-[1.3rem] border border-slate-900/8 bg-white/80 px-4 py-4 text-sm leading-6 text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Na blogu najdeš</p>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Praktické zápisky z provozu, stavby a úpravy antén, zkušenosti s vybavením i konkrétní výsledky z éteru.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
