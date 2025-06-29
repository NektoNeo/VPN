#!/bin/bash

# Найти все изображения
find . -type f \( -iname "*.png" -o -iname "*.svg" -o -iname "*.ico" -o -iname "*.jpg" -o -iname "*.jpeg" \) \
     | sort > image_list.txt

echo "✅ Список найденных изображений сохранён в image_list.txt"
