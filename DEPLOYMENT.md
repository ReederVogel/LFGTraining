# Deployment Guide - Vercel

This guide will help you deploy the LFGTraining Platform to Vercel.

## Prerequisites

1. A GitHub account with this repository pushed
2. A Vercel account (sign up at https://vercel.com)
3. Your API keys ready:
   - **LiveAvatar API Key** from [HeyGen Dashboard](https://app.heygen.com/)
   - **Deepgram API Key** from [Deepgram Console](https://console.deepgram.com/)

## Quick Deployment Steps

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/rva1
   - Click "Add New..." → "Project"

2. **Import Your Repository**
   - Select "Import Git Repository"
   - Choose: `ReederVogel/LFGTraining`
   - Click "Import"

3. **Configure Project**
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (leave as default)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)

4. **Add Environment Variables** ⚠️ CRITICAL STEP
   
   Click "Environment Variables" and add:
   
   ```
   Name: LIVEAVATAR_API_KEY
   Value: [paste your HeyGen/LiveAvatar API key]
   
   Name: NEXT_PUBLIC_DEEPGRAM_API_KEY
   Value: [paste your Deepgram API key]
   ```

5. **Deploy**
   - Click "Deploy"
   - Wait 2-3 minutes for build to complete
   - Your app will be live at: `https://lfgtraining.vercel.app` (or similar)

### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy from Project Root**
   ```bash
   cd C:\Users\ACER\Downloads\realtime-trining-app
   vercel
   ```

4. **Follow CLI Prompts**
   - Link to existing project or create new one
   - Confirm settings
   - CLI will provide deployment URL

5. **Add Environment Variables**
   ```bash
   vercel env add LIVEAVATAR_API_KEY
   vercel env add NEXT_PUBLIC_DEEPGRAM_API_KEY
   ```

## Environment Variables Reference

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `LIVEAVATAR_API_KEY` | Server-side API key for LiveAvatar/HeyGen | [HeyGen Dashboard](https://app.heygen.com/) |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Client-side API key for speech recognition | [Deepgram Console](https://console.deepgram.com/) |

## Post-Deployment Checklist

After deployment, verify everything works:

- [ ] Visit your deployed URL
- [ ] Click "New Session" button
- [ ] Select an avatar (Sarah or Michael)
- [ ] Allow microphone access when prompted
- [ ] Speak to the avatar and verify:
  - [ ] Avatar responds to your speech
  - [ ] Transcripts appear in real-time
  - [ ] Video quality is 60 FPS and crisp
  - [ ] Audio is clear and natural

## Automatic Deployments

Once connected to GitHub, Vercel will automatically:
- ✅ Deploy on every push to `main` branch
- ✅ Create preview deployments for pull requests
- ✅ Run builds in production environment
- ✅ Use the same environment variables

## Custom Domain (Optional)

To add a custom domain:

1. Go to your project in Vercel Dashboard
2. Click "Settings" → "Domains"
3. Add your domain (e.g., `training.lfgtraining.com`)
4. Follow DNS configuration instructions
5. SSL certificate auto-generated

## Troubleshooting

### Build Fails
- Check that `package.json` has all dependencies
- Verify Node.js version compatibility (18.17+)
- Check build logs in Vercel Dashboard

### Environment Variables Not Working
- Ensure variable names are EXACT (case-sensitive)
- `NEXT_PUBLIC_*` variables must start with that prefix
- Redeploy after adding/changing variables

### Avatar Not Loading
- Verify `LIVEAVATAR_API_KEY` is set correctly
- Check API key is active in HeyGen Dashboard
- Review runtime logs in Vercel Dashboard

### Transcripts Not Working
- Verify `NEXT_PUBLIC_DEEPGRAM_API_KEY` is set
- Check Deepgram API key has available credits
- Check browser console for errors

## Support

- **Vercel Documentation**: https://vercel.com/docs
- **Next.js Deployment**: https://nextjs.org/docs/deployment
- **Project Issues**: https://github.com/ReederVogel/LFGTraining/issues

## Performance Monitoring

Vercel provides built-in analytics:
- Visit: https://vercel.com/rva1/[project-name]/analytics
- Monitor:
  - Page load times
  - Core Web Vitals
  - Function execution times
  - Bandwidth usage

---

**Version**: 2.0.0  
**Last Updated**: November 21, 2025

