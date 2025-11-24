"use client";

export default function TestEnvPage() {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Environment Variable Test</h1>
      <div className="space-y-2">
        <p>
          <strong>API Key Present:</strong> {apiKey ? "Yes" : "No"}
        </p>
        <p>
          <strong>API Key Value:</strong> {apiKey ? `${apiKey.substring(0, 10)}...` : "Not set"}
        </p>
        <p>
          <strong>All NEXT_PUBLIC_ vars:</strong>
        </p>
        <pre className="bg-gray-100 p-4 rounded">
          {JSON.stringify(
            Object.keys(process.env)
              .filter((k) => k.startsWith("NEXT_PUBLIC_"))
              .reduce((acc, key) => {
                acc[key] = process.env[key]?.substring(0, 10) + "...";
                return acc;
              }, {} as Record<string, string>),
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}

