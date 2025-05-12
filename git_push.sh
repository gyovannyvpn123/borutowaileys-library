#!/data/data/com.termux/files/usr/bin/bash

# Setări Git
git config --global user.name "gyovannyvpn123"
git config --global user.email "mdanut159@gmail.com"

# Inițializare Git dacă nu există deja
if [ ! -d .git ]; then
  git init
fi

# Adăugare și commit fișiere
git add .
git commit -m "Push automat din Termux"

# Setare link remote
git remote remove origin 2> /dev/null
git remote add origin https://github.com/gyovannyvpn123/borutowaileys-library.git

# Cerere token de acces
read -p "Introdu tokenul GitHub: " token

# Push cu token
git push https://$token@github.com/gyovannyvpn123/borutowaileys-library.git main
