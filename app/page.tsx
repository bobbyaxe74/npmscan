export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans">
      <main className="max-w-3xl mx-auto py-16 px-6">
        <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          npmscan API
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-10">
          Analyze npm package files for security vulnerabilities via a simple API call.
          Powered by{" "}
          <a
            href="https://npmscan.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-zinc-900 dark:text-zinc-100"
          >
            npmscan.com
          </a>
          .
        </p>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
            Endpoint
          </h2>
          <code className="block bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-800 dark:text-zinc-200">
            POST /api/analyze
          </code>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
            Request
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-3">
            Send the contents of a <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">package.json</code> or{" "}
            <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">package-lock.json</code> file as the JSON body.
          </p>
          <pre className="bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 text-sm overflow-auto text-zinc-800 dark:text-zinc-200">{`curl -X POST https://your-deployment.vercel.app/api/analyze \\
  -H "Content-Type: application/json" \\
  -d @package.json`}</pre>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
            Response
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-3">
            Returns a JSON object with the analysis results from npmscan.com.
          </p>
          <pre className="bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 text-sm overflow-auto text-zinc-800 dark:text-zinc-200">{`{
  "success": true,
  "analysisUrl": "https://npmscan.com/...",
  "title": "...",
  "results": "...",
  "headings": [...],
  "tables": [...]
}`}</pre>
        </section>
      </main>
    </div>
  );
}
