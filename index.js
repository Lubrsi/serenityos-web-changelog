"use strict";

(() => {
    const dateElement = document.getElementById("date");
    const loadingIndicator = document.getElementById("loading-indicator");
    const changelogElement = document.getElementById("changelog");
    const changelogBodyElement = document.getElementById("changelog-body");
    const yesterdayButton = document.getElementById("yesterday-button");
    const todayButton = document.getElementById("today-button");
    const tomorrowButton = document.getElementById("tomorrow-button");
    const noCommitsMessage = document.getElementById("no-commits");
    const showAllButton = document.getElementById("show-all");
    const hideAllButton = document.getElementById("hide-all");
    const commitCountElement = document.getElementById("commit-count");

    const loadFailedAlert = document.getElementById("load-failed");
    const loadFailedRateLimitedAlert = document.getElementById("load-failed-rate-limited");
    const partialLoadRateLimitedAlert = document.getElementById("partial-load-rate-limited");
    const loadFailedBadTokenAlert = document.getElementById("load-failed-bad-token");
    const partialLoadBadTokenAlert = document.getElementById("partial-load-bad-token");

    const accessTokenFormCollapse = document.getElementById("access-token-form-collapse");
    const accessTokenForm = document.getElementById("access-token-form");
    const accessTokenInput = document.getElementById("token-input");
    const removeAccessTokenButton = document.getElementById("remove-access-token-button");
    const noAccessTokenAlert = document.getElementById("no-access-token-alert");
    const haveAccessTokenAlert = document.getElementById("have-access-token-alert");
    const submitAccessTokenButton = document.getElementById("submit-access-token-button");

    const monthlyToggleCheckbox = document.getElementById("monthly-toggle");
    const lastMonthButton = document.getElementById("last-month-button");
    const thisMonthButton = document.getElementById("this-month-button");
    const nextMonthButton = document.getElementById("next-month-button");
    const dailyButtons = document.getElementById("daily-buttons");
    const monthlyButtons = document.getElementById("monthly-buttons");

    const categoryTemplate = document.getElementById("category-template");
    const commitElementTemplate = document.getElementById("commit-element-template");

    const numCommitsPerPage = 100; // This is just a guess based on how many commits we have a day.
    const categoryRegex = /(^\S[^"]*?):/;
    const titleMessageRegex = /: ?(.*)/; // A regex is used instead of splitting in case the title has multiple ':'.
    const invalidSelectorCharacters = /([>+\/.* ,])/g; // FIXME: This is definitely not a complete regex.
    const startsWithNumberRegex = /^\d/;

    const hasFetch = !!window.fetch; // This is mostly for opening the page with LibWeb, as it does not currently support fetch().
    const hasLocalStorage = !!window.localStorage; // This is mostly for opening the page with LibWeb, as it does not currently support localStorage.

    let currentAccessToken = null;

    let ongoingFetchAbortController = null;

    let categoryCollapseElements = [];

    const params = new URLSearchParams(window.location.search);

    const isMonthlyParam = params.get("monthly");
    let monthly = isMonthlyParam === "true";

    let date;

    if (!monthly) {
        const dateParam = params.get("date");
        date = new Date(dateParam);

        if (dateParam === null) {
            date = new Date();
        }
    }

    if (isNaN(date)) {
        date = new Date();

        if (monthly) {
            const yearParam = params.get("year");
            const monthParam = params.get("month");

            if (yearParam !== null && monthParam !== null) {
                const yearNum = parseInt(yearParam, 10);
                const monthNum = parseInt(monthParam, 10);

                if (!isNaN(yearNum) && !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
                    date.setFullYear(yearNum, monthNum - 1);
                }
            }
        }
    }

    if (monthly) {
        monthlyToggleCheckbox.checked = true;
    }

    function showAppropriateDateButtons() {
        if (monthly) {
            dailyButtons.classList.add("d-none");
            monthlyButtons.classList.remove("d-none");
        } else {
            dailyButtons.classList.remove("d-none");
            monthlyButtons.classList.add("d-none");
        }
    }

    showAppropriateDateButtons();

    let year = date.getFullYear();
    let monthNumber = date.getMonth() + 1; // This is 0-based.
    let dateNumber = date.getDate();

    updateURLQuery();

    if (hasLocalStorage) {
        const hasAccessToken = window.localStorage.getItem("access-token") !== null;

        if (!hasAccessToken) {
            noAccessTokenAlert.classList.remove("d-none");
            haveAccessTokenAlert.classList.add("d-none");
        } else {
            noAccessTokenAlert.classList.add("d-none");
            haveAccessTokenAlert.classList.remove("d-none");

            const accessToken = window.localStorage.getItem("access-token");

            accessTokenInput.value = accessToken;
            currentAccessToken = accessToken;
        }
    }

    // https://stackoverflow.com/a/16353241
    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
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
            default:
                // April, June, September, November
                return 30;
        }
    }

    // Returns true if aborted an _ongoing_ fetch (i.e. not previously aborted), false otherwise.
    function abortFetchIfNeeded() {
        if (!ongoingFetchAbortController) return false;

        const previouslyAborted = ongoingFetchAbortController.signal.aborted;
        ongoingFetchAbortController.abort();
        return !previouslyAborted;
    }

    function setDateToToday() {
        abortFetchIfNeeded();

        // May have potentially gone past midnight.
        const today = new Date();

        year = today.getFullYear();
        monthNumber = today.getMonth() + 1; // This is 0-based.
        dateNumber = today.getDate();

        updateURLQuery();
        createChangelog();
    }

    yesterdayButton.onclick = () => {
        abortFetchIfNeeded();

        dateNumber--;

        if (dateNumber <= 0) {
            const switchingYear = monthNumber - 1 <= 0;
            dateNumber = getLastDayOfMonth(
                !switchingYear ? year : year - 1,
                !switchingYear ? monthNumber - 1 : 12
            );
            monthNumber--;
        }

        if (monthNumber <= 0) {
            monthNumber = 12;
            year--;
        }

        updateURLQuery();
        createChangelog();
    };

    todayButton.onclick = setDateToToday;

    tomorrowButton.onclick = () => {
        abortFetchIfNeeded();

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

    lastMonthButton.onclick = () => {
        abortFetchIfNeeded();

        monthNumber--;

        if (monthNumber <= 0) {
            monthNumber = 12;
            year--;
        }

        updateURLQuery();
        createChangelog();
    };

    thisMonthButton.onclick = setDateToToday;

    nextMonthButton.onclick = () => {
        abortFetchIfNeeded();

        monthNumber++;

        if (monthNumber > 12) {
            monthNumber = 1;
            year++;
        }

        updateURLQuery();
        createChangelog();
    };

    monthlyToggleCheckbox.onchange = () => {
        abortFetchIfNeeded();

        monthly = monthlyToggleCheckbox.checked;

        showAppropriateDateButtons();
        updateURLQuery();
        createChangelog();
    };

    showAllButton.onclick = () => {
        categoryCollapseElements.forEach(element => {
            element.show();
        });
    };

    hideAllButton.onclick = () => {
        categoryCollapseElements.forEach(element => {
            element.hide();
        });
    };

    accessTokenForm.onsubmit = submitEvent => {
        submitEvent.preventDefault();

        // Don't allow the user to change the access token whilst fetching commits.
        if (submitAccessTokenButton.disabled) return;

        const abortedFetch = abortFetchIfNeeded();

        const accessToken = accessTokenInput.value;
        if (hasLocalStorage) window.localStorage.setItem("access-token", accessToken);
        currentAccessToken = accessToken;

        const tokenFormCollapse = new bootstrap.Collapse(accessTokenFormCollapse, {
            toggle: false,
        });
        tokenFormCollapse.hide();

        noAccessTokenAlert.classList.add("d-none");
        haveAccessTokenAlert.classList.remove("d-none");

        if (abortedFetch)
            createChangelog();
    };

    removeAccessTokenButton.onclick = () => {
        if (hasLocalStorage) window.localStorage.removeItem("access-token");

        accessTokenInput.value = "";
        currentAccessToken = null;

        const tokenFormCollapse = new bootstrap.Collapse(accessTokenFormCollapse, {
            toggle: false,
        });
        tokenFormCollapse.hide();

        noAccessTokenAlert.classList.remove("d-none");
        haveAccessTokenAlert.classList.add("d-none");
    };

    function fetchFailed() {
        loadFailedAlert.classList.remove("d-none");
    }

    async function getPageNumber(url, parameters, pageNumber) {
        parameters.page = pageNumber;

        let finalUrl = url;

        let firstKey = true;
        for (const key in parameters) {
            finalUrl += `${firstKey ? "?" : "&"}${key}=${parameters[key]}`;
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
                        resolve(JSON.parse(this.responseText));
                    else reject();
                });
                // LibWeb does not expose "onerror" just yet, but does fire the error event.
                xhr.addEventListener("error", () => reject());
                xhr.send();
            });
        }

        const headers = {
            Accept: "application/vnd.github.v3+json",
        };

        if (currentAccessToken !== null) {
            headers["Authorization"] = `token ${currentAccessToken}`;
        }

        ongoingFetchAbortController = new AbortController();

        return fetch(finalUrl, {
            headers,
            referrerPolicy: "no-referrer",
            signal: ongoingFetchAbortController.signal,
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

                if (shouldStop(jsonResponse)) break;
            } else {
                finalResponse = finalResponse.concat(response);

                if (shouldStop(response)) break;
            }

            pageNumber++;
        }

        return finalResponse;
    }

    function enableDateButtons() {
        yesterdayButton.disabled = false;
        todayButton.disabled = false;
        tomorrowButton.disabled = false;
        monthlyToggleCheckbox.disabled = false;
        lastMonthButton.disabled = false;
        thisMonthButton.disabled = false;
        nextMonthButton.disabled = false;
    }

    function disableDateButtons() {
        yesterdayButton.disabled = true;
        todayButton.disabled = true;
        tomorrowButton.disabled = true;
        monthlyToggleCheckbox.disabled = true;
        lastMonthButton.disabled = true;
        thisMonthButton.disabled = true;
        nextMonthButton.disabled = true;
    }

    function getISODateString() {
        const month = monthNumber.toString().padStart(2, "0");
        const date = dateNumber.toString().padStart(2, "0");
        return `${year}-${month}-${date}`;
    }

    function updateURLQuery() {
        if (!monthly) {
            window.history.replaceState(
                null,
                null,
                `?date=${getISODateString()}&monthly=${monthly}`
            );
        } else {
            window.history.replaceState(
                null,
                null,
                `?month=${monthNumber}&year=${year}&monthly=${monthly}`
            );
        }
    }

    async function createChangelog() {
        const currentDate = new Date(year, monthNumber - 1, dateNumber);

        if (!monthly) {
            dateElement.textContent = `For ${currentDate.toDateString()}`;
        } else {
            const monthNames = [
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ];
            const monthName = monthNames[monthNumber - 1];
            dateElement.textContent = `For ${monthName} ${year}`;
        }

        noCommitsMessage.classList.add("d-none");
        loadFailedAlert.classList.add("d-none");
        loadFailedRateLimitedAlert.classList.add("d-none");
        partialLoadRateLimitedAlert.classList.add("d-none");
        loadFailedBadTokenAlert.classList.add("d-none");
        partialLoadBadTokenAlert.classList.add("d-none");

        loadingIndicator.classList.remove("d-none");

        if (!hasFetch) {
            disableDateButtons();
            submitAccessTokenButton.disabled = true;
        }

        changelogElement.classList.add("d-none");
        changelogBodyElement.innerHTML = "";

        categoryCollapseElements = [];

        try {
            const shouldStop = jsonResponse => {
                // If there's the exact number of commits we requested, we can't know for sure if that's all of them.
                // This is because the GH API doesn't tell us if there is anymore data, so we just have to fetch the next page.
                return jsonResponse.length !== numCommitsPerPage;
            };

            const parameters = {};

            if (!monthly) {
                parameters["since"] = `${getISODateString()}T00:00:00Z`;
                parameters["until"] = `${getISODateString()}T23:59:59Z`;
            } else {
                const lastDay = getLastDayOfMonth(year, monthNumber);

                const month = monthNumber.toString().padStart(2, "0");
                const date = lastDay.toString().padStart(2, "0");

                parameters["since"] = `${year}-${month}-01T00:00:00Z`;
                parameters["until"] = `${year}-${month}-${date}T23:59:59Z`;
            }

            const commits = await paginate(
                "https://api.github.com/repos/SerenityOS/serenity/commits",
                parameters,
                shouldStop
            );

            loadingIndicator.classList.add("d-none");

            if (!hasFetch) {
                enableDateButtons();
                submitAccessTokenButton.disabled = false;
            }

            if (commits.length === 0) {
                noCommitsMessage.classList.remove("d-none");
                return;
            }

            // If the last commit contains "message" and "documentation_url", this means we've been rejected.
            const lastCommit = commits[commits.length - 1];
            if (lastCommit.message !== undefined && lastCommit.documentation_url !== undefined) {
                // FIXME: This is a bit crude.
                if (lastCommit.message === "Bad credentials") {
                    // If there's only one entry, that means there are no other commits to show.
                    // Show an error and return.
                    if (commits.length === 1) {
                        loadFailedBadTokenAlert.classList.remove("d-none");
                        return;
                    }

                    // If there's more than one entry, we can show the partial list.
                    // Show a warning and remove the last "commit", but don't return.
                    partialLoadBadTokenAlert.classList.remove("d-none");
                    commits.pop();
                } else {
                    // If there's only one entry, that means there are no other commits to show.
                    // Show an error and return.
                    if (commits.length === 1) {
                        loadFailedRateLimitedAlert.classList.remove("d-none");
                        return;
                    }

                    // If there's more than one entry, we can show the partial list.
                    // Show a warning and remove the last "commit", but don't return.
                    partialLoadRateLimitedAlert.classList.remove("d-none");
                    commits.pop();
                }
            }

            changelogElement.classList.remove("d-none");

            const plural = commits.length > 1 ? "s" : "";
            commitCountElement.textContent = `${commits.length} commit${plural}`;

            const rootCategory = new Category(null, "Root");

            commits.forEach(commit => {
                const commitCategories = categorizeCommitMessage(commit.commit.message);
                rootCategory.insertInto(commit, commitCategories);
            });

            rootCategory.forEachSorted((commit, index, category) => {
                const validSelectorCategory = category.validSelector;

                const accordionCollapseId = `${validSelectorCategory}-collapse`;
                const accordionHeaderId = `${accordionCollapseId}-heading`;
                const categoryId = `${validSelectorCategory}-category`;
                const parentElement =
                    category.isRoot || category.superCategory.isRoot
                        ? changelogBodyElement
                        : document.querySelector(
                              `#${category.superCategory.validSelector}-collapse > ul`
                          );

                const createAndAppendSection = () => {
                    const categorySectionElement =
                        categoryTemplate.content.cloneNode(true).firstElementChild;
                    categorySectionElement.id = categoryId;
                    parentElement.classList.add("accordion");
                    parentElement.appendChild(categorySectionElement);

                    categorySectionElement.querySelector("h4.accordion-header").id =
                        accordionHeaderId;

                    const categoryCollapseOpenButtonElement = categorySectionElement.querySelector(
                        "h4.accordion-header button"
                    );
                    categoryCollapseOpenButtonElement.dataset.bsTarget = `#${accordionCollapseId}`;
                    categoryCollapseOpenButtonElement.textContent = category.name;

                    const categoryCollapseElement =
                        categorySectionElement.querySelector("div.accordion-collapse");
                    categoryCollapseElement.id = accordionCollapseId;
                    categoryCollapseElement.setAttribute("aria-labelledby", accordionHeaderId);

                    const categoryCollapseBootstrapClass = new bootstrap.Collapse(
                        categoryCollapseElement,
                        { toggle: false }
                    );
                    categoryCollapseElements.push(categoryCollapseBootstrapClass);

                    const commitCountElement = categorySectionElement.querySelector("ul > h6");
                    const sectionPlural = category.commitCount !== 1 ? "s" : "";
                    commitCountElement.textContent = `${category.commitCount} commit${sectionPlural}`;
                    categorySectionElement
                        .querySelector("ul.accordion-body")
                        .appendChild(commitCountElement);

                    return categorySectionElement;
                };

                const matchingSections = document.querySelectorAll(`section#${categoryId}`);
                const categorySectionElement =
                    matchingSections.length > 0
                        ? matchingSections[0]
                        : createAndAppendSection(changelogBodyElement);

                // This is a fake commit so that all category accordions are properly created.
                if (index === -1) return;

                const commitElements = commitElementTemplate.content.cloneNode(true);
                const commitListEntryElement = commitElements.querySelector("li");
                const commitTitleElement = commitListEntryElement.querySelector("a");

                const messageParts = commit.commit.message.split("\n");
                if (category !== "Uncategorized") {
                    const titleMessage = titleMessageRegex.exec(messageParts[0])[1];
                    commitTitleElement.textContent = titleMessage;
                } else {
                    commitTitleElement.textContent = messageParts[0];
                }
                commitTitleElement.href = commit.html_url;

                const detailsId = `${validSelectorCategory}${index}`.replace(
                    invalidSelectorCharacters,
                    ""
                );

                const detailsButtonElement = commitListEntryElement.querySelector("button");
                detailsButtonElement.dataset.bsTarget = `#${detailsId}`;
                detailsButtonElement.setAttribute("aria-controls", detailsId);

                const commitDetailsElement = commitElements.querySelector("div");
                commitDetailsElement.id = detailsId;
                const committerDetailsElement = commitDetailsElement.querySelector("div > h5");

                const authorName = committerDetailsElement.querySelector("span.author-name");
                if (commit.author !== null) {
                    if (commit.author.login !== commit.committer.login) {
                        // Use the small, 20x20 version as we limit the image size to 20x20.
                        committerDetailsElement.querySelector(
                            "img.author-image"
                        ).dataset.src = `${commit.author.avatar_url}&s=20`;
                        authorName.textContent = `${commit.author.login} authored`;
                    } else {
                        committerDetailsElement
                            .querySelector("img.author-image")
                            .classList.add("d-none");
                        authorName.classList.add("d-none");
                    }
                } else {
                    committerDetailsElement
                        .querySelector("img.author-image")
                        .classList.add("d-none");
                    authorName.classList.add("me-2");
                    authorName.textContent = `${commit.commit.author.name} authored`;
                }

                // This occurs if the commit is signed.
                if (commit.commit.committer.name !== "GitHub") {
                    if (!commit.author || commit.author.login !== commit.committer.login)
                        authorName.textContent += " and";
                    authorName.classList.add("me-2");

                    // Use the small, 20x20 version as we limit the image size to 20x20.
                    committerDetailsElement.querySelector(
                        "img.committer-image"
                    ).dataset.src = `${commit.committer.avatar_url}&s=20`;

                    committerDetailsElement.querySelector(
                        "span.committer-name"
                    ).textContent = `${commit.committer.login} committed`;
                }

                const commitMessageElement = commitDetailsElement.querySelector("div > pre");

                if (messageParts.length > 1) {
                    messageParts.forEach((part, index) => {
                        // Skip the commit message and 2 newlines.
                        if (index < 2) return;

                        commitMessageElement.textContent += part + "\n";
                    });
                } else {
                    committerDetailsElement.classList.add("mb-0");
                }

                // We need to do this last as the array spread removes the children from the HTMLCollection.
                categorySectionElement
                    .querySelector("ul.list-unstyled")
                    .append(...commitElements.children);
            });
        } catch (e) {
            // Aborting the fetch is not an error here.
            if (e.name === "AbortError") return;

            console.error(e);
            loadingIndicator.classList.add("d-none");
            fetchFailed();
            enableDateButtons();
        }
    }

    function categorizeCommitMessage(message) {
        message = message.trim();
        const categoryResult = categoryRegex.exec(message);
        if (!categoryResult) return ["Uncategorized"];

        const categoryString = categoryResult[1];
        let categories = [];
        if (categoryString.indexOf("+") >= 0)
            categories.push(...categoryString.split("+").map(c => c.trim()));
        else categories.push(categoryString.trim());

        return categories;
    }

    class Category {
        #commits = [];
        #subCategories = new Map();

        constructor(superCategory, name) {
            this.superCategory = superCategory;
            this.name = name;
        }

        get validSelector() {
            let validSelectorCategory = this.name.replace(invalidSelectorCharacters, "");
            if (startsWithNumberRegex.test(validSelectorCategory)) {
                // Selectors starting with a number are invalid. Just prepend an 'i' to counteract it.
                validSelectorCategory = "i" + validSelectorCategory;
            }
            return this.isRoot
                ? validSelectorCategory
                : `${this.superCategory.validSelector}-${validSelectorCategory}`;
        }

        get isRoot() {
            return !this.superCategory;
        }

        get commitCount() {
            return this.#commits.length;
        }

        // The given categories are just strings.
        // Inserts the commit into the lowest-level category for each of the categories given.
        insertInto(commit, categories) {
            for (const category of categories) {
                if (category.indexOf("/") < 0) {
                    const lcCategory = category.toLowerCase();
                    if (!this.#subCategories.has(lcCategory))
                        this.#subCategories.set(lcCategory, new Category(this, category));
                    this.#subCategories.get(lcCategory).#commits.push(commit);
                } else {
                    const [firstSubCategory, lowerCategories] = category.split("/", 2);
                    const lcFirstSubCategory = firstSubCategory.toLowerCase();
                    if (!this.#subCategories.has(lcFirstSubCategory)) {
                        this.#subCategories.set(
                            lcFirstSubCategory,
                            new Category(this, firstSubCategory)
                        );
                    }
                    this.#subCategories
                        .get(lcFirstSubCategory)
                        .insertInto(commit, [lowerCategories]);
                }
            }
        }

        sortedSubcategories() {
            // For the sort: https://stackoverflow.com/a/45544166
            const allKeys = [...this.#subCategories.keys()];
            return allKeys.sort((left, right) => left.localeCompare(right));
        }

        // The order used by this is: first all the commits from this category, then recursively everything from the subcategories.
        // Both are traversed in locale-sensitive alphabetical order.
        forEachSorted(funktion) {
            this.#commits.sort();

            // Call the function at least once for each non-root category, so that all accordions can be created properly.
            // For identifying these, index -1 is used.
            if (!this.isRoot) funktion({}, -1, this);

            for (const [index, commit] of this.#commits.entries()) {
                funktion(commit, index, this);
            }
            this.sortedSubcategories().forEach(categoryKey => {
                let subCategory = this.#subCategories.get(categoryKey);
                subCategory.forEachSorted(funktion);
            });
        }
    }

    const retryButtons = document.querySelectorAll(".retry-fetch");
    retryButtons.forEach(button => {
        button.onclick = createChangelog;
    });

    // Enable the disabled by default date buttons if we have fetch, as we can allow the user to change the dates by aborting the fetch.
    if (hasFetch) enableDateButtons();

    createChangelog();
})();
