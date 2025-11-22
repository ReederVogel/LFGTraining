# Quick script to add environment variables to Vercel
# Run this after you have your API keys

Write-Host "🔧 Adding Environment Variables to Vercel rva1 team..." -ForegroundColor Cyan
Write-Host ""

# Add LIVEAVATAR_API_KEY
Write-Host "📝 Adding LIVEAVATAR_API_KEY..." -ForegroundColor Yellow
Write-Host "Paste your HeyGen/LiveAvatar API key when prompted:" -ForegroundColor Green
vercel env add LIVEAVATAR_API_KEY production --scope rva1

Write-Host ""
Write-Host "📝 Adding NEXT_PUBLIC_DEEPGRAM_API_KEY..." -ForegroundColor Yellow
Write-Host "Paste your Deepgram API key when prompted:" -ForegroundColor Green
vercel env add NEXT_PUBLIC_DEEPGRAM_API_KEY production --scope rva1

Write-Host ""
Write-Host "✅ Environment variables added!" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Now redeploying with new environment variables..." -ForegroundColor Cyan
vercel --prod --scope rva1 --yes

Write-Host ""
Write-Host "✅ COMPLETE! Your app is ready at: https://realtime-trining-luy9vnjr1-rva1.vercel.app" -ForegroundColor Green




