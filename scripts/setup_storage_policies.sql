-- Storage RLS Policies for task-images bucket
-- Run this in Supabase SQL Editor

-- Allow authenticated users to upload images
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'task-images');

-- Allow public read access (bucket is public)
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'task-images');

-- Allow authenticated users to delete images
CREATE POLICY "Allow authenticated deletes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'task-images');
