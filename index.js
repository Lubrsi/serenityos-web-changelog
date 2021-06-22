"use strict";

(() => {
    const dateElement = document.getElementById("date");
    const loadFailedAlert = document.getElementById("load-failed");
    const loadingIndicator = document.getElementById("loading-indicator");
    const changelogElement = document.getElementById("changelog");
    const yesterdayButton = document.getElementById("yesterday-button");
    const todayButton = document.getElementById("today-button");
    const tomorrowButton = document.getElementById("tomorrow-button");
    const noCommitsMessage = document.getElementById("no-commits");

    const numCommitsPerPage = 100; // This is just a guess based on how many commits we have a day.
    const categoryRegex = /(^\S[^"]*?):/;
    const titleMessageRegex = /: (.*)/; // A regex is used instead of splitting in case the title has multiple ':'.
    const invalidSelectorCharacters = /([>+\/.])/g; // FIXME: This is definitely not a complete regex.
    const startsWithNumberRegex = /^\d/;

    const hasFetch = !!window.fetch; // This is mostly for opening the page with LibWeb, as it does not currently support fetch().

    let categoryCollapseElements = [];

    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    let date = new Date(dateParam);
    if (dateParam === null || isNaN(date)) {
        date = new Date();
    }

    let year = date.getFullYear();
    let monthNumber = date.getMonth() + 1; // This is 0-based.
    let dateNumber = date.getDate();

    updateURLQuery();

    // https://stackoverflow.com/a/16353241
    function isLeapYear(year) {
        return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0);
    }

    function getLastDayOfMonth(year, month) {
        switch (month) {
            case 1: // January
            case 3: // March
            case 5: // May
            case 7: // July
            case 8: // August
            case 10: // October
            case 12: // December
                return 31;
            case 2: // February
                return isLeapYear(year) ? 29 : 28;
            default: // April, June, September, November
                return 30;
        }
    }

    yesterdayButton.onclick = () => {
        dateNumber--;

        if (dateNumber <= 0) {
            const switchingYear = monthNumber - 1 <= 0;
            dateNumber = getLastDayOfMonth(!switchingYear ? year : year - 1, !switchingYear ? monthNumber - 1 : 12);
            monthNumber--;
        }

        if (monthNumber <= 0) {
            monthNumber = 12;
            year--;
        }

        updateURLQuery();
        createChangelog();
    };

    todayButton.onclick = () => {
        // May have potentially gone past midnight.
        const today = new Date();

        year = today.getFullYear();
        monthNumber = today.getMonth() + 1; // This is 0-based.
        dateNumber = today.getDate();

        updateURLQuery();
        createChangelog();
    };

    tomorrowButton.onclick = () => {
        dateNumber++;

        if (dateNumber > getLastDayOfMonth(year, monthNumber)) {
            dateNumber = 1;
            monthNumber++;
        }

        if (monthNumber > 12) {
            monthNumber = 1;
            year++;
        }

        updateURLQuery();
        createChangelog();
    };

    function fetchFailed() {
        loadFailedAlert.classList.remove("d-none");
    }

    async function getPageNumber(url, parameters, pageNumber) {
        parameters.page = pageNumber;

        let finalUrl = url;

        let firstKey = true;
        for (const key in parameters) {
            finalUrl += `${firstKey ? '?' : '&'}${key}=${parameters[key]}`;
            firstKey = false;
        }

        if (!hasFetch) {
            return new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("GET", finalUrl);
              xhr.setRequestHeader("Accept", "application/vnd.github.v3+json");
              // LibWeb does not expose "onload" just yet, but does fire the load event.
              xhr.addEventListener("load", function () {
                  if (this.status >= 200 && this.status <= 299)
                      resolve(JSON.parse(this.responseText))
                  else
                      reject();
              });
              // LibWeb does not expose "onerror" just yet, but does fire the error event.
              xhr.addEventListener("error", () => reject());
              xhr.send();
            });
        }

        return fetch(finalUrl, {
            headers: {
                "Accept": "application/vnd.github.v3+json"
            },
        });
    }

    async function paginate(url, parameters, shouldStop) {
        let pageNumber = 1;

        let finalResponse = [];

        parameters.per_page = numCommitsPerPage;

        while (true) {
            const response = await getPageNumber(url, parameters, pageNumber);

            if (hasFetch) {
                const jsonResponse = await response.json();
                finalResponse = finalResponse.concat(jsonResponse);

                if (shouldStop(jsonResponse))
                    break;
            } else {
                finalResponse = finalResponse.concat(response);

                if (shouldStop(response))
                    break;
            }

            pageNumber++;
        }

        return finalResponse;
    }

    function enableDateButtons() {
        yesterdayButton.removeAttribute("disabled");
        todayButton.removeAttribute("disabled");
        tomorrowButton.removeAttribute("disabled");
    }

    function disableDateButtons() {
        yesterdayButton.setAttribute("disabled", "");
        todayButton.setAttribute("disabled", "");
        tomorrowButton.setAttribute("disabled", "");
    }

    function getISODateString() {
        const month = monthNumber.toString().padStart(2, "0");
        const date = dateNumber.toString().padStart(2, "0");
        return `${year}-${month}-${date}`;
    }

    function updateURLQuery() {
        window.history.replaceState(null, null, `?date=${getISODateString()}`);
    }

    async function createChangelog() {
        const currentDate = new Date(year, monthNumber - 1, dateNumber);
        dateElement.textContent = `For ${currentDate.toDateString()}`;

        noCommitsMessage.classList.add("d-none");
        loadFailedAlert.classList.add("d-none");

        loadingIndicator.classList.remove("d-none");

        disableDateButtons();

        changelogElement.innerHTML = "";

        categoryCollapseElements = [];

        try {
            const shouldStop = (jsonResponse) => {
                // If there's the exact number of commits we requested, we can't know for sure if that's all of them.
                // This is because the GH API doesn't tell us if there is anymore data, so we just have to fetch the next page.
                return jsonResponse.length !== numCommitsPerPage;
            }

            const commits = await paginate("https://api.github.com/repos/SerenityOS/serenity/commits", {
                since: `${getISODateString()}T00:00:00Z`,
                until: `${getISODateString()}T23:59:59Z`
            }, shouldStop);

            loadingIndicator.classList.add("d-none");
            enableDateButtons();

            if (commits.length === 0) {
                noCommitsMessage.classList.remove("d-none");
                return;
            }

            const categories = [];

            commits.forEach((commit) => {
                const categoryResult = categoryRegex.exec(commit.commit.message);
                const category = categoryResult ? categoryResult[1] : "Uncategorized";

                const hasCategory = categories[category] !== undefined;

                if (!hasCategory)
                    categories[category] = [];

                categories[category].push(commit);
            });

            // For the sort: https://stackoverflow.com/a/45544166
            const sortedCategories = Object.keys(categories).sort((left, right) => left.localeCompare(right));

            sortedCategories.forEach((category) => {
                const commits = categories[category];
                let validSelectorCategory = category.replace(invalidSelectorCharacters, '');
                if (startsWithNumberRegex.test(validSelectorCategory)) // Selectors starting with a number are invalid. Just prepend an 'i' to counteract it.
                    validSelectorCategory = 'i' + validSelectorCategory;

                const accordionCollapseId = `${validSelectorCategory}-collapse`;
                const accordionHeaderId = `${accordionCollapseId}-heading`;

                const categorySectionElement = document.createElement("section");
                categorySectionElement.classList.add("accordion-item");
                changelogElement.appendChild(categorySectionElement);

                const categoryHeaderElement = document.createElement("h4");
                categoryHeaderElement.id = accordionHeaderId;
                categoryHeaderElement.classList.add("accordion-header");
                categorySectionElement.appendChild(categoryHeaderElement);

                const categoryCollapseOpenButtonElement = document.createElement("button");
                categoryCollapseOpenButtonElement.classList.add("accordion-button");
                categoryCollapseOpenButtonElement.type = "button";
                categoryCollapseOpenButtonElement.setAttribute("data-bs-toggle", "collapse");
                categoryCollapseOpenButtonElement.setAttribute("data-bs-target", `#${accordionCollapseId}`);
                categoryCollapseOpenButtonElement.setAttribute("aria-expanded", "true");
                categoryCollapseOpenButtonElement.setAttribute("aria-controls", accordionCollapseId);
                categoryCollapseOpenButtonElement.textContent = category;
                categoryHeaderElement.appendChild(categoryCollapseOpenButtonElement);

                const categoryCollapseElement = document.createElement("div");
                categoryCollapseElement.id = accordionCollapseId;
                categoryCollapseElement.classList.add("accordion-collapse", "collapse", "show");
                categoryCollapseElement.setAttribute("aria-labelledby", accordionHeaderId);
                categorySectionElement.appendChild(categoryCollapseElement);

                const categoryCollapseBootstrapClass = new bootstrap.Collapse(categoryCollapseElement, { toggle: false });
                categoryCollapseElements.push(categoryCollapseBootstrapClass);

                const commitListElement = document.createElement("ul");
                commitListElement.classList.add("accordion-body", "list-unstyled");
                categoryCollapseElement.appendChild(commitListElement);

                commits.forEach((commit, index) => {
                    const commitListEntryElement = document.createElement("li");
                    commitListEntryElement.classList.add("d-flex", "align-items-center")
                    commitListElement.appendChild(commitListEntryElement);

                    const commitTitleElement = document.createElement("a");
                    const messageParts = commit.commit.message.split('\n');

                    if (category !== "Uncategorized") {
                        const titleMessage = titleMessageRegex.exec(messageParts[0])[1];
                        commitTitleElement.textContent = titleMessage;
                    } else {
                        commitTitleElement.textContent = messageParts[0];
                    }

                    commitTitleElement.href = commit.html_url;
                    commitTitleElement.target = "_blank";
                    commitTitleElement.setAttribute("rel", "noopener noreferrer");
                    commitListEntryElement.appendChild(commitTitleElement);

                    const detailsId = `${validSelectorCategory}${index}`.replace(invalidSelectorCharacters, '');

                    const detailsButtonElement = document.createElement("button");
                    detailsButtonElement.classList.add("btn", "btn-primary", "details-button", "ms-2");
                    detailsButtonElement.setAttribute("type", "button");
                    detailsButtonElement.setAttribute("data-bs-toggle", "collapse");
                    detailsButtonElement.setAttribute("data-bs-target", `#${detailsId}`);
                    detailsButtonElement.setAttribute("aria-expanded", "false");
                    detailsButtonElement.setAttribute("aria-controls", detailsId)
                    detailsButtonElement.textContent = "Details";
                    commitListEntryElement.appendChild(detailsButtonElement);

                    const commitDetailsElement = document.createElement("div");
                    commitDetailsElement.id = detailsId;
                    commitDetailsElement.classList.add("collapse", "mt-2");
                    commitListElement.appendChild(commitDetailsElement);

                    const commitDetailsBodyElement = document.createElement("div");
                    commitDetailsBodyElement.classList.add("card", "card-body");
                    commitDetailsElement.appendChild(commitDetailsBodyElement);

                    const committerDetailsElement = document.createElement("h5");
                    committerDetailsElement.classList.add("card-title", "d-flex", "align-items-center");
                    commitDetailsBodyElement.appendChild(committerDetailsElement);

                    let authorName;

                    if (commit.author !== null) {
                        if (commit.author.login !== commit.committer.login) {
                            const authorImage = document.createElement("img");
                            authorImage.classList.add("lazyload", "img-fluid", "rounded");
                            authorImage.width = 20;
                            authorImage.height = 20;
                            // Use the small, 20x20 version as we limit the image size to 20x20.
                            authorImage.setAttribute("data-src", commit.author.avatar_url + "&s=20");
                            committerDetailsElement.appendChild(authorImage);

                            authorName = document.createElement("span");
                            authorName.classList.add("ms-2", "me-2");
                            authorName.textContent = `${commit.author.login} authored`;
                        }
                    } else {
                        authorName = document.createElement("span");
                        authorName.classList.add("me-2");
                        authorName.textContent = `${commit.commit.author.name} authored`;
                    }

                    if (authorName)
                        committerDetailsElement.appendChild(authorName);

                    // This occurs if the commit is signed.
                    if (commit.commit.committer.name !== "GitHub") {
                        if (!commit.author || commit.author.login !== commit.committer.login)
                            authorName.textContent += " and";

                        const committerImage = document.createElement("img");
                        committerImage.classList.add("lazyload", "img-fluid", "rounded");
                        // Use the small, 20x20 version as we limit the image size to 20x20.
                        committerImage.setAttribute("data-src", commit.committer.avatar_url + "&s=20");
                        committerImage.width = 20;
                        committerImage.height = 20;
                        committerDetailsElement.appendChild(committerImage);

                        const committerName = document.createElement("span");
                        committerName.classList.add("ms-2");
                        committerName.textContent = `${commit.committer.login} committed`;
                        committerDetailsElement.appendChild(committerName);
                    }

                    const commitMessageElement = document.createElement("pre");
                    commitMessageElement.classList.add("card-text");

                    if (messageParts.length > 1) {
                        messageParts.forEach((part, index) => {
                            // Skip the commit message and 2 newlines.
                            if (index < 2)
                                return;

                            commitMessageElement.textContent += part + "\n";
                        });

                        commitDetailsBodyElement.appendChild(commitMessageElement);
                    } else {
                        committerDetailsElement.classList.add("mb-0");
                    }
                });
            });
        } catch (e) {
            console.error(e);
            loadingIndicator.classList.add("d-none");
            fetchFailed();
        }
    }

    const retryButton = document.getElementById("retry");
    retryButton.onclick = createChangelog;

    createChangelog();
})();
